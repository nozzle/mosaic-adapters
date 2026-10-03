# Pivot client

`createPivotClient<TRow>(options)` — true crosstabs via DuckDB `PIVOT` (mosaic-sql's `PivotQuery`), with the output columns discovered from each result's Arrow schema.

```ts
const bySex = createPivotClient({
  coordinator,
  from: 'athletes',
  on: 'sex',
  using: [{ agg: 'sum', column: 'gold', as: 'gold' }],
  groupBy: ['sport'],
  filterBy: $page,
  inputs: { orderBy: [{ column: 'sport' }] },
});
// bySex.store.state → { rows, pivotColumns: ['female_gold', 'male_gold'], … }
```

## Dynamic columns

DuckDB derives one output column per distinct `on` value. The client surfaces the result columns that are not `groupBy` columns as `pivotColumns`, re-discovered on every query — cross-filtering that removes a pivot value shrinks the column set. Generate column defs from it rather than hardcoding.

- Naming follows DuckDB: an unaliased single aggregate keeps bare value names (`Q1`); an alias suffixes them (`Q1_total`); multiple aggregates need aliases to stay distinguishable.
- `in: [...]` pins the column set (`PIVOT … IN (…)`) regardless of the data.

## Aggregates

`using` is declarative (serializable): `Array<{ agg: 'count' | 'sum' | 'avg' | 'min' | 'max', column?, as? }>` — at least one required; every agg except `'count'` requires a column.

`on`, `groupBy`, and `using[].column` accept struct paths (`'meta.country'`). DuckDB rejects qualified column references inside `PIVOT`, so the client first projects each path onto the source under its dotted name (`SELECT *, "meta"."country" AS "meta.country" FROM (…)`); a `groupBy` path therefore keeps its dotted name as the output column, and `inputs.orderBy` can sort by it. Without dotted names the source is not wrapped and the SQL is unchanged. If the source already has a column literally named `meta.country`, the projection would shadow it ambiguously — pass `columnPaths: 'literal'` to read every dotted name as one identifier and skip the projection.

`inputs` follows the rows client (`orderBy` / `limit` / `offset`, appended to the pivot query). `coerce` (closure or descriptor map) maps raw rows, latest-ref'd via `setCoerce`.

## Pre-aggregation

The output columns themselves change under filtering, so this client always runs with `filterStable: false`.
