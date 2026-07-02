# Rows client

`createRowsClient<TRow>(options)` — paginated, sorted, cross-filtered rows. The workhorse behind tables (TanStack Table in fully manual mode renders `rows`/`totalRows` verbatim).

```ts
const athletes = createRowsClient<AthleteRow>({
  coordinator,
  query: ({ where }) =>
    Query.from('athletes').select('id', 'name', 'sport', 'weight').where(where),
  filterBy: $page,
  inputs: { orderBy: [{ column: 'name' }], limit: 25, offset: 0 },
  rowCount: 'window',
  publish: { select: { as: $picked, columns: ['id'] } },
});
```

## Inputs

`RowsInputs` is plain JSON: `{ orderBy?: Array<{column, desc?, nullsFirst?}>, limit?: number, offset?: number }`.

- `inputMode: 'append'` (default) — the client appends `ORDER BY` / `LIMIT` / `OFFSET` derived from inputs after the factory's base query.
- `inputMode: 'manual'` — the factory consumes `ctx.inputs` itself (for SQL where the window must live somewhere non-trivial, e.g. inside a subquery before a join); the client appends nothing.

## Row counts

`rowCount` controls `store.state.totalRows`:

- `'window'` — appends `count(*) OVER ()` to the main query: the **filtered** total in one round trip. Requires `inputMode: 'append'` (the client must own the LIMIT wrapper); combining it with `'manual'` throws. Caveat: a page offset past the end returns zero rows, so the total reads 0.
- `'query'` — a separate `COUNT(*)` query sharing the same WHERE/HAVING (built from the factory with `orderBy`/`limit`/`offset` stripped from inputs). Use this with `inputMode: 'manual'`.
- `'none'` (default) — `totalRows` stays `undefined`.

## Publishing

Opt-in per channel; both publish native `clausePoints` with a stable clause source, `meta: {type: 'point'}`, and the client in the clause `clients` set (self-exclusion under cross-filtering):

- `publish.select: { as, columns }` — `selectRows(rows)` publishes the rows' column values as a point clause; `selectRows([])` clears it.
- `publish.hover: { as, columns, throttleMs? }` — `hoverRow(row)` publishes a transient single-point clause; `hoverRow(null)` clears. Throttled by default (50ms trailing) against mouse-speed clause churn; `throttleMs: 0` disables.

`destroy()` removes any published clauses before disconnecting.

## Other

- `coerce?` — presentational per-row mapper (Arrow values → display types): a closure `(raw) => TRow`, or the serializable per-column descriptor map `{ date_of_birth: 'date', score: 'number' }` (`'date' | 'number' | 'string' | 'boolean'`; unlisted columns pass through, null stays null). Latest-ref'd; swap with `setCoerce`.
- `prefetch(inputsPatch)` — builds the query for the merged inputs and warms the coordinator cache (e.g. the next page while the user reads the current one).
