# Rollup client

`createRollupClient<TRow>(options)` — hierarchical grouping as one SQL query: `GROUP BY ROLLUP(…)` fetches the whole tree (grand total, every level's subtotals, leaves), tagged by `GROUPING()` and pre-ordered parents-before-children. Expansion is UI visibility, not a data operation.

```ts
const medals = createRollupClient<MedalRollup>({
  coordinator,
  query: ({ where }) =>
    Query.from('athletes')
      .select({ athletes: count(), gold: sum('gold') })
      .where(where),
  groupBy: ['sport', 'nationality'],
  filterBy: $page,
});
// medals.store.state.rows → Array<RollupRow<TRow>>
```

The factory supplies the **aggregate select only** — no `groupby`: the client owns `GROUP BY ROLLUP`, the injected `GROUPING()` level tag, the group-column projections, and the tree order. A bare-string query source throws (it would ROLLUP over un-aggregated columns); so does an empty `groupBy`.

## RollupRow

Each flat row carries its tree position:

- `level` — `0` is the grand total, `groupBy.length` a leaf; rolled-up group columns are `NULL` in `data`.
- `groupPath` — the group values down to this row's level (stringified): a stable key for expansion state (e.g. TanStack Table `expanded`).
- `isLeaf`.

Rows arrive pre-ordered (each subtotal immediately precedes its children — real `NULL` group values are disambiguated from rolled-up `NULL`s by the `GROUPING` tag), so "expanded" rendering is a pure filter over the flat list. `rollupRowsToTree(rows)` derives a nested `{row, children}` view when a tree shape is easier.

`coerce` (closure or per-column descriptor map) maps raw rows to `TRow`, latest-ref'd via `setCoerce`.

## Pre-aggregation

Which subtotal rows exist changes under filtering, so this client always runs with `filterStable: false`.
