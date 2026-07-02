# Membership subqueries

Utilities for `column [NOT] IN (SELECT …)` predicates — the shape behind "keep rows whose question appears on ≥ N domains" or "narrow every widget to the groups another widget's HAVING keeps".

```ts
import {
  buildSubqueryPredicate,
  createSubqueryClause,
  updateClauseIfChanged,
} from '@nozzleio/react-mosaic'; // re-exported from @nozzleio/mosaic-core

const subquery = Query.select({ question: sql`"related_phrase"."phrase"` })
  .from('nozzle_paa')
  .groupby(sql`"related_phrase"."phrase"`)
  .having(gt(count(), literal(5)));

updateClauseIfChanged(
  $members,
  createSubqueryClause({
    source: MEMBERS_SOURCE, // stable identity, one clause per source
    value: '> 5', // app-level display value (chips)
    predicate: buildSubqueryPredicate({
      column: 'related_phrase.phrase', // dotted paths become struct access
      query: subquery,
    }),
  }),
);
```

## The pieces

- `buildSubqueryPredicate({ column, query, negate? })` — builds `column [NOT] IN (<query>)` on mosaic-sql's `InOpNode` + `ScalarSubqueryNode`. `column` accepts dotted struct paths.
- `createSubqueryClause(spec)` — a Selection clause for subquery-bearing predicates. Structurally identical to `createValueClause` except `meta` is forbidden: Mosaic's PreAggregator assumes `point`/`interval` clauses have simple value-test shapes, and a subquery predicate tagged that way produces incorrect optimized queries. Without `meta`, Mosaic uses the standard query path.
- `updateClauseIfChanged(selection, clause)` — `selection.update` with change suppression: skips when the source's existing clause has an equal predicate (compared by generated SQL) or when clearing a source with no active clause. Every suppressed update avoids a Selection value event — and with it a re-query of every consumer. The comparison is predicate-only: a clause whose `value` changed with an unchanged predicate is also suppressed.

## Embedding sibling context (and converging)

Mosaic's filter pushdown does **not** rewrite table references inside scalar subqueries: a membership subquery is not constrained by the page's other Selection clauses. If the subquery should respect them (so siblings match exactly what the source widget shows), embed the context predicate yourself and rebuild when it changes:

```ts
const contextPredicate = $sourceContext.predicate(null); // FilterExpr | undefined
subquery.where(contextPredicate ?? []);

$sourceContext.addEventListener('value', republish);
```

`updateClauseIfChanged` is the convergence guard for this rebuild-on-change loop: a rebuilt-but-identical predicate publishes nothing, so a converged state stops republishing. Avoid making two subquery publishers mutually context-dependent — each rebuild embeds the other's previous predicate and never converges.

## Declarative form: the filter builder's `subquery` mode

For input-driven membership filters, prefer a filter definition with a `subquery` factory over hand-rolled publishing — the binding controller owns the context listener, the reentrancy guard, and committed-state persistence:

```ts
const minDomains: NumberFilterDefinition = {
  id: 'question-min-domains',
  column: 'related_phrase.phrase',
  valueKind: 'number',
  operators: ['gte'],
  subquery: ({ state, contextPredicate }) => {
    const n = Number(state.value);
    if (!Number.isFinite(n) || n <= 0) {
      return null; // no predicate — the filter clears
    }
    const question = sql`"related_phrase"."phrase"`;
    const query = Query.select({ question })
      .from('nozzle_paa')
      .groupby(question)
      .having(gte(count('domain').distinct(), n));
    if (contextPredicate) {
      query.where(contextPredicate);
    }
    return query; // or { query, negate: true }
  },
};
```

`contextPredicate` is the AND of sibling filters from the runtime's `context` Selection (own clause excluded); it is `null` when no context is attached. See [Filter builder](./filter-builder.md).
