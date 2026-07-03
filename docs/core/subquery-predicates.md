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

## Declarative form: a FilterSet `subqueryFilterKind`

For input-driven membership filters, prefer a registered [FilterSet](./filter-set.md) kind built with `subqueryFilterKind` over hand-rolled publishing — the set owns the context listener, the change-suppression guard, and (optional) persistence. The factory receives `args.spec` and `args.contextPredicate`; return a `Query` (or `{ query, negate: true }`), or `null` to clear:

```ts
const minDomainsKind: FilterKind = {
  ...subqueryFilterKind((args) => {
    const n = Number(args.spec.value);
    if (!Number.isFinite(n) || n <= 0) {
      return null; // no predicate — the filter clears
    }
    const question = sql`"related_phrase"."phrase"`;
    return Query.select({ question })
      .from('nozzle_paa')
      .groupby(question)
      .having(gte(count('domain').distinct(), n));
  }),
  formatValue: (spec) => `≥ ${String(spec.value)}`,
};

const filters = createFilterSet({
  targets: { where: $where },
  kinds: { 'min-domains': minDomainsKind },
  context: $page,
});
```

`args.contextPredicate` is the AND of sibling filters from the set's `context` Selection (own spec's clause excluded); embed it in the subquery `WHERE` when the membership set should react to the rest of the page. It is `null` when no context is attached. Reading it registers the context-rebuild dependency, so the set republishes the predicate whenever siblings change. See [Filter set](./filter-set.md).
