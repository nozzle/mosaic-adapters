# Rows client

`createRowsClient<TRow>(options)` — paginated, sorted, cross-filtered rows. The workhorse behind tables (TanStack Table in fully manual mode renders `rows`/`totalRows` verbatim).

```ts
const athletes = createRowsClient<AthleteRow>({
  coordinator,
  query: ({ where }) => Query.from('athletes').select('id', 'name', 'sport', 'weight').where(where),
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
- `'query'` — a separate `COUNT(*)` query sharing the same WHERE/HAVING (built from the factory with `orderBy`/`limit`/`offset` stripped from inputs). Because those inputs are stripped, the count SQL changes only when the WHERE/HAVING/base predicate does: the client memoizes the last-issued count SQL and **re-runs the count only when the predicate changes** (and on an explicit `refetch()`, in case the data changed underneath). Page turns and sort changes reuse the standing total with no extra round trip. Use this with `inputMode: 'manual'`. Because the count is a side-channel query, a count failure never touches `status`/`error` — those belong to the main rows query, and a failed count must not wedge rows that loaded fine. It is reported through `coordinator.logger().error(...)` (the same logger the coordinator uses for main-query failures) and the memo is dropped, so the next predicate change re-issues it.
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

`filterStable` (default `true`, upstream parity) is a promise to Mosaic's pre-aggregation optimizer: **filtering can't change which groups exist.** Histogram bins are the canonical safe case — the bin edges come from a fixed extent, so a brush only changes each bin's count, never the set of bins (the [histogram client](./histogram-client.md) keeps the default for that reason). A factory that `GROUP BY`s a data key (a category, a phrase, a user) almost never qualifies: filtering removes keys outright.

When the promise is wrong, Mosaic answers selection updates from a materialized view it builds once from `client.query()` with the _active_ clause removed (sibling clauses still applied); every part of the query that varies with the active filter beyond the `WHERE` clause — the `GROUP BY` domain included — is frozen at that pre-active shape and never rebuilt while the brush moves. An optimizer path that _fails_ (view creation or the pre-aggregated update) degrades to a correct, slower standard query, logged through the coordinator's logger — but a wrong-but-valid pre-aggregated query still returns incorrect rows with no error, and the fallback cannot detect it. **Pass `filterStable: false` on rows clients whose groups depend on the data.**

- **Lineage.** Mosaic 0.32 traces the client query through `Query.with()` CTEs, FROM subqueries and set operations to a single base table, and pushes the active clause's columns into nested `GROUP BY`s. CTEs added _outside_ `Query.with()` — SQL text wrapped around the query, or a table name that only resolves because a CTE is prepended elsewhere — are invisible to that lineage; pass `filterStable: false` for those queries.
- **When pre-aggregation applies.** Only when a `filterBy` Selection is set and the outer `SELECT` (or `HAVING` / `QUALIFY` / `ORDER BY`) has a structured aggregate such as `count()` or `sum()`. Plain row lists, a grouping that only sits inside a subquery under a plain outer `SELECT`, and the `rowCount: 'window'` wrapper always use the standard query, so `filterStable` has no effect on them.
- **The warning.** The client warns once (re-checking each build until it fires) when pre-aggregation could apply, `filterStable` was left defaulted, and the query uses `GROUP BY`, `SELECT DISTINCT`, `QUALIFY`, a window function (in `SELECT` or `ORDER BY`) or `PIVOT` — at the top level or inside a `Query.with()` CTE, FROM subquery or set operation member. Predicate subqueries (`IN (SELECT …)`) are not inspected. Any explicit `filterStable` (`false`, or `true` for fixed bins) silences it.
- **Other clients.** The facet/rollup/pivot/sparkline clients already default or force `false` for the same reason. A non-empty [`skipSources`](./concepts.md#per-widget-filter-scoping) also forces `filterStable: false` regardless of this option, so a skipped clause cannot be re-applied by the pre-aggregation optimizer outside the client's query callback.

## Other

- `coerce?` — presentational per-row mapper (Arrow values → display types): a closure `(raw) => TRow`, or the serializable per-column descriptor map `{ date_of_birth: 'date', score: 'number' }` (`'date' | 'number' | 'string' | 'boolean'`; unlisted columns pass through, null stays null). Latest-ref'd; swap with `setCoerce`. The `'date'` descriptor treats an epoch bigint past ~year 2286 (Parquet/DuckDB `TIMESTAMP` microseconds) as µs and scales it to ms, so those columns decode correctly rather than to a far-future date.
- `prefetch(inputsPatch)` — builds the query for the merged inputs and warms the coordinator cache (e.g. the next page while the user reads the current one).
