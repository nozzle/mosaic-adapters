# Data client concepts

`@nozzleio/mosaic-core` is a headless Mosaic client library. Its central primitive is the **data client**: a SQL query factory plus native Mosaic Selections/Params in, a reactive typed store out. A page is a graph of clients sharing a coordinator and communicating via Selections; tables, charts, KPI cards, and filter chips are thin renderers of client output.

The mental model is "React Query for Mosaic": serializable intent flows in (sorting, pagination — plain JSON), data flows out (rows, totals, records). Every data operation executes in SQL.

## The query factory

Every client is fed by a `QuerySource`: a table name, or a factory receiving a `QueryContext`:

```ts
const client = createRowsClient({
  coordinator,
  query: ({ where, having }) =>
    Query.from('athletes').select('id', 'name', 'sport').where(where),
  filterBy: $page, // native Selection → WHERE
  havingBy: $agg, // native Selection → HAVING (our extension; upstream is WHERE-only)
});
```

- `where` is `filterBy.predicate(client)` — already self-excluded under cross-filtering. It is `[]` when unfiltered, so `.where(where)` needs no guard.
- `having` is the same for `havingBy`. Predicate validity in HAVING position (aggregate references) is the caller's responsibility.
- `inputs` is the current inputs object; only consume it with `inputMode: 'manual'`.

The factory is held by **latest-ref** (React-Query `queryFn` style): a new function identity never re-queries. Swap it with `client.setQuery(fn)`; the next trigger uses the latest factory. This structurally eliminates function-identity re-query bugs.

## Re-query triggers

Exactly four things trigger a query:

1. **Inputs change** — `setInputs(patch)` merge-patches and value-diffs; a value-equal patch is a no-op, a changed patch issues exactly one query.
2. **Selection updates** — `filterBy` via the native coordinator wiring; `havingBy` via the client's own wiring.
3. **Param change** — every Param in `params` re-queries the client on its `'value'` event (upstream never does this automatically).
4. **`refetch()`** — force a query with current state.

## The store

Every client exposes a `@tanstack/store` `Store`. The base shape:

```ts
{
  status: 'idle' | 'pending' | 'success' | 'error',
  error: Error | null,
  inputs: TInputs,         // echo of what the last query was built from — never a source of truth
  lastQuery: string | null // SQL of the last main query (observability)
}
```

Specializations add their payload (`rows`/`totalRows`, `values`). Read `store.state`, subscribe with `store.subscribe`.

## Selection topology

A whole page typically runs on **one** `Selection.crossfilter()`. Every filter UI publishes clauses into it; every client consumes it via `filterBy`. Native cross-mode resolution excludes each publisher from its own clause (the clause `clients` set), so views cascade correctly with no adapter-level selection manager. Note that self-exclusion is cross-mode only: use `Selection.crossfilter()`, not plain `intersect()`, for a shared page context.

Publishing (clause emission) is per-client, built on shared clause utilities (`createValueClause`, `createSubqueryClause`, `createClearClause`). The rows client publishes row selection and hover; there is no generic publish slot in the base contract.

## Lifecycle

- `setEnabled(false)` defers queries (and the initial load) until re-enabled — for offscreen views.
- `destroy()` removes the client's published clauses, unwires Params/Selections, and disconnects from the coordinator.
- `mosaicClient` exposes the wrapped upstream `MosaicClient` for coordinator/vgplot interop; vgplot marks are Mosaic clients too and share the same Selection graph with no extra machinery.
