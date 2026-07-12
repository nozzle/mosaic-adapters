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

- `'window'` — wraps the base in a subquery and adds `count(*) OVER ()` at the outer scope (`SELECT *, count(*) OVER () FROM (<base>)`, with `ORDER BY`/`LIMIT`/`OFFSET` on the wrapper): the **filtered** total in one round trip. Wrapping keeps the count correct over a `DISTINCT` or set-operation base — an in-scope `count(*) OVER ()` alongside the base's own columns would count pre-dedup rows (or fail to attach at all). Requires `inputMode: 'append'` (the client must own the LIMIT wrapper); combining it with `'manual'` throws. Because `ORDER BY` binds against the wrapper's `SELECT *`, sort columns must be projected by the base query in window mode — ordering by an unprojected column is a binder error. Caveat: a page offset past the end returns zero rows, so the total reads 0.
- `'query'` — a separate `COUNT(*)` query sharing the same WHERE/HAVING (built from the factory with `orderBy`/`limit`/`offset` stripped from inputs). Because those inputs are stripped, the count SQL changes only when the WHERE/HAVING/base predicate does: the client memoizes the last-issued count SQL and **re-runs the count only when the predicate changes** (and on an explicit `refetch()`, in case the data changed underneath). Page turns and sort changes reuse the standing total with no extra round trip. Use this with `inputMode: 'manual'`.
- `'none'` (default) — `totalRows` stays `undefined`.

**Cost.** The `'window'` count re-executes over the full filtered relation on every page (benchmarks on a 5M-row table showed roughly 4× a plain page query on large ungrouped tables; grouped queries are cheap). `'query'` issues a second round trip, but its SQL string is stable across pages, so the client memoizes it and skips re-issuing on a page turn or sort change — the count re-runs only when the predicate changes (or on `refetch()`), and even then the coordinator cache serves an unchanged count. That makes `'query'` cheap and cache-friendly — prefer it for large ungrouped tables and reserve `'window'` for grouped or modestly sized relations where the single round trip wins.

## Publishing

Opt-in per channel; both publish native `clausePoints` with a stable clause source, `meta: {type: 'point'}`, and the client in the clause `clients` set (self-exclusion under cross-filtering):

- `publish.select: { as, columns }` — `selectRows(rows)` publishes the rows' column values as a point clause; `selectRows([])` clears it.
- `publish.hover: { as, columns, throttleMs? }` — `hoverRow(row)` publishes a transient single-point clause; `hoverRow(null)` clears. Throttled by default (50ms trailing) against mouse-speed clause churn; `throttleMs: 0` disables.

`setSelectedValues(tuples)` is the tuple-level equivalent of `selectRows` — value arrays aligned to `publish.select.columns` (arity-checked), not row objects. Use it to replay stored intent after a reload, where the original row objects no longer exist (`selectRows` needs them). `[]` clears. An external clause removal (chip bar, `selection.reset()`) resets the tracked selection.

`destroy()` removes any published clauses before disconnecting.

Two extras cover grouped/remounting widgets:

- `fields?: Array<string>` — the SQL fields the published predicate tests, aligned with `columns` and defaulting to them. Use it when a row field aliases an expression: a grouped factory selecting `related_phrase.phrase AS key` publishes `columns: ['key'], fields: ['related_phrase.phrase']`. Dotted paths become struct access (`"related_phrase"."phrase"`), never one quoted identifier.
- `source?: ClauseSource` — a caller-provided stable clause identity that outlives the client instance. With it, `destroy()` **retains** the published clause and the next client instance publishing under the same source replaces it — row-selection state survives widget remounts (enlarge/collapse swaps) whose Selections live longer than the component. Read the value back with `selection.valueFor(source)` (or `useMosaicSelectionValue` in React).

## Persistence

`persist?: Persister<Array<Array<unknown>>>` stores the selected tuples — value arrays aligned to `publish.select.columns` (see [concepts](./concepts.md#persistence)). A synchronous `read` hydrates via `setSelectedValues` before the first query; requires a `publish.select` target (a warning fires and persistence is ignored without one). Hover is never persisted.

## Grouped queries and `filterStable`

`filterStable` (default `true`, upstream parity) tells Mosaic's optimizer the filtered domain is stable enough for pre-aggregation. A factory that `GROUP BY`s a key almost never qualifies — filtering changes which groups exist — and the wrong optimizer path can hang on pre-aggregated tables with no error. **Pass `filterStable: false` on grouped rows clients.** The client warns once at query time when it sees a GROUP BY under a defaulted `filterStable`. (The facet/rollup/pivot clients already default or force `false` for the same reason.)

## Other

- `coerce?` — presentational per-row mapper (Arrow values → display types): a closure `(raw) => TRow`, or the serializable per-column descriptor map `{ date_of_birth: 'date', score: 'number' }` (`'date' | 'number' | 'string' | 'boolean'`; unlisted columns pass through, null stays null). Latest-ref'd; swap with `setCoerce`. The `'date'` descriptor treats an epoch bigint past ~year 2286 (Parquet/DuckDB `TIMESTAMP` microseconds) as µs and scales it to ms, so those columns decode correctly rather than to a far-future date.
- `prefetch(inputsPatch)` — builds the query for the merged inputs and warms the coordinator cache (e.g. the next page while the user reads the current one).
