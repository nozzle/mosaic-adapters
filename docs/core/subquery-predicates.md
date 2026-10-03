# Membership subqueries

Utilities for `column [NOT] IN (SELECT …)` predicates — the shape behind "keep rows whose question appears on ≥ N domains" or "narrow every widget to the groups another widget's HAVING keeps".

```ts
import {
  buildSubqueryClauseParts,
  createSubqueryClause,
  updateClauseIfChanged,
} from '@nozzleio/react-mosaic'; // re-exported from @nozzleio/mosaic-core

const subquery = Query.select({ question: sql`"related_phrase"."phrase"` })
  .from('nozzle_paa')
  .groupby(sql`"related_phrase"."phrase"`)
  .having(gt(count(), literal(5)));

// `predicate` and `fields` share the same column node instances, which the
// clause's `fields` must reference (Mosaic 0.29 field-identity requirement).
const { predicate, fields } = buildSubqueryClauseParts({
  column: 'related_phrase.phrase', // dotted paths become struct access
  query: subquery,
});

updateClauseIfChanged(
  $members,
  createSubqueryClause({
    source: MEMBERS_SOURCE, // stable identity, one clause per source
    value: '> 5', // app-level display value (chips)
    fields, // the outer column nodes the predicate filters over
    predicate,
  }),
);
```

## The pieces

- `buildSubqueryClauseParts({ column, query, negate? })` — builds `{ predicate, field, fields }`: the `column [NOT] IN (<query>)` predicate (on mosaic-sql's `InOpNode` + `ScalarSubqueryNode`), the expression it tests (`field`), and the outer column nodes it references (`fields`, use them as the clause's `fields`). `column` accepts dotted struct paths, or an array of them for a [composite key](#composite-keys); pass `columnPaths: 'literal'` to read each dotted name as one identifier instead. `buildSubqueryPredicate(...)` returns just the predicate when you don't need the fields.
- `createSubqueryClause(spec)` — a Selection clause for subquery-bearing predicates. Requires `fields` (the input column nodes the predicate references, from `buildSubqueryClauseParts`). Structurally identical to `createValueClause` except `meta` is forbidden: Mosaic's PreAggregator assumes `point`/`interval` clauses have simple value-test shapes, and a subquery predicate tagged that way produces incorrect optimized queries. Without `meta`, Mosaic uses the standard query path.
- `updateClauseIfChanged(selection, clause)` — `selection.update` with change suppression: skips when the source's existing clause has an equal predicate (compared by generated SQL) or when clearing a source with no active clause. Every suppressed update avoids a Selection value event — and with it a re-query of every consumer. The comparison is predicate-only: a clause whose `value` changed with an unchanged predicate is also suppressed.

## Composite keys

Pass an array to `column` to test several columns at once. The subquery must select one column per entry, in the same order:

```ts
const { predicate, fields } = buildSubqueryClauseParts({
  column: ['domain', 'related_phrase.phrase'],
  query: Query.select('domain', { phrase: sql`"related_phrase"."phrase"` })
    .from('nozzle_paa')
    .groupby('domain', sql`"related_phrase"."phrase"`)
    .having(gt(count(), literal(5))),
});
// ("domain", "related_phrase"."phrase") IN (SELECT "domain", "related_phrase"."phrase" AS "phrase" …)
// fields: [the "domain" node, the "related_phrase"."phrase" node]
```

`field` is then the mosaic-sql `TupleNode` that wraps the columns, and `fields` holds one node per column. Both are the same instances the predicate holds. A one-element array behaves exactly like a single column. An empty array throws.

How NULLs behave (checked on DuckDB):

- A row whose key tuple holds a NULL (`(NULL, 'x')`) is never matched. Against a nonempty subquery, `negate: true` drops it too: the test is unknown, not false, and `NOT unknown` is still unknown. Against an empty subquery every test is false, so `negate: true` keeps every row, NULL keys included.
- If any tuple the subquery returns holds a NULL, every row that matches no tuple tests as unknown instead of false, even when another column already differs. So `negate: true` drops those rows as well, the same as single-column `NOT IN` with a NULL in the list. Filter NULL keys out of the subquery (`WHERE domain IS NOT NULL AND …`) when a negated membership should keep those rows.

`subqueryFilterKind(build, { columns })` emits the composite form from a FilterSet kind (see below).

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

The kind uses the spec's `column` as the outer column. Pass `{ columns: ['a', 'b'] }` as the second argument for a [composite key](#composite-keys). The spec's `columnPaths` applies to every outer column. The emission's `fields` always holds every outer column node.

`args.contextPredicate` is the AND of sibling filters from the set's `context` Selection (own spec's clause excluded); embed it in the subquery `WHERE` when the membership set should react to the rest of the page. It is `null` when no context is attached. Reading it registers the context-rebuild dependency, so the set republishes the predicate whenever siblings change. See [Filter set](./filter-set.md).
