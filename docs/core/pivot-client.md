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

`inputs` follows the rows client (`orderBy` / `limit` / `offset`, appended to the pivot query). `coerce` (closure or descriptor map) maps raw rows, latest-ref'd via `setCoerce`.

## Pre-aggregation

The output columns themselves change under filtering, so this client always runs with `filterStable: false`.
