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
2. **Selection updates** — `filterBy` via the native coordinator wiring; `havingBy` via the client's own wiring. Passing the same Selection as both routes its predicate into both WHERE and HAVING on a single re-query per activation (rarely what you want; prefer a separate Selection for aggregate predicates).
3. **Param change** — every Param in `params` re-queries the client on its `'value'` event (upstream never does this automatically).
4. **`refetch()`** — force a query with current state.

The input-driven triggers (`setInputs`, Param and `havingBy` `'value'` events) are **coalesced**: a burst of synchronous changes in one tick collapses into a single query build (the last state wins) instead of one query per event. In browsers this rides upstream `requestUpdate()`, which throttles on an animation frame; in environments without `requestAnimationFrame` (Node, workers) the client falls back to a macrotask flush with the same one-build-per-tick semantics. `status` still flips to `'pending'` synchronously so loading stays responsive. `refetch()` bypasses coalescing and queries immediately.

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

To name a page's whole Selection graph as data — so widgets reference selections by name and a dashboard spec is serializable — see [Selection topology](./selection-topology.md); it resolves a declarative config to these same Selection instances at mount.

## Per-widget filter scoping

A widget consuming a shared Selection can opt out of _specific_ clauses in it while honoring the rest, via `skipSources` — a `ReadonlySet<string>` of clause source ids to ignore when resolving `filterBy` into WHERE **and** `havingBy` into HAVING:

```ts
// Every other widget honors the page's date range; this one ignores it —
// e.g. an all-time total shown alongside the date-filtered views.
const allTime = createValuesClient({
  coordinator,
  query: ({ where }) =>
    Query.from('events').select({ total: count() }).where(where),
  filterBy: $page,
  skipSources: new Set(['date_range']),
});
```

Matching is by the stable id a clause's source carries (`clause.source.id`) — the same id a [filter set](./filter-set.md) spec is keyed by. One spec can fan out to several clauses (an aggregate-threshold emits a `having:` clause plus `members:` clauses); skipping the id drops **all** of that spec's clauses from the Selection being resolved. A clause whose source carries no string `id` is never skipped.

Skipping composes on top of everything else the Selection's resolver does: crossfilter self-exclusion still applies, and union / intersect / `empty` semantics are preserved — resolution delegates to the Selection's own resolver rather than a hand-rolled one. An absent or empty set is byte-identical to not passing the option.

A non-empty set forces `filterStable: false` (pre-aggregation off): Mosaic's pre-aggregation optimizer re-applies the active clause _outside_ the client's query callback, which would otherwise leak a skipped clause back in.

To render a widget **fully unfiltered**, omit `filterBy` — do not enumerate every source in `skipSources`.

Publishing (clause emission) is per-client, built on shared clause utilities (`createValueClause`, `createSubqueryClause`, `createClearClause`). The rows client publishes row selection and hover; there is no generic publish slot in the base contract. External publishers (like the [TanStack Table filter bridge](../tanstack-table/integration.md)) build on the same utilities; `deepEqual` — the value-equality the core diffs inputs with — is exported for them to diff with the same semantics.

## Persistence

The publishing clients (facet, histogram, rows) accept a `persist` option — a consumer-owned storage adapter for filter **intent**, so a selection survives a reload:

```ts
interface Persister<TState> {
  read: (ctx) => TState | null | undefined | Promise<…>;
  write: (state: TState | null, ctx: { reason }) => void;
}
```

- **Intent, not clauses.** `TState` is the publish-side client state (facet selection, histogram range, rows tuples), never SQL clauses — clauses are derived. There is no key in the contract: the consumer's `read`/`write` closures already know where they point.
- **Lifecycle, no blocking.** A **synchronous** `read` is applied inside `prepare`, before the first query — the first query is already filtered (no flash, no extra query). A **thenable** `read` never blocks: the first query issues unfiltered, and the state applies on resolve (a re-query is accepted). A late async result is discarded if the user has interacted in the meantime, or the client was destroyed.
- **Reasons.** `write` receives `{ reason }`: `'update'` (local action, state non-empty), `'clear'` (local action emptied it — `state` is `null`), `'external'` (someone else removed the clause — chip bar, `selection.reset()`; `state` is `null`).
- **Echo suppression.** Hydration is replayed through the same publish path as user interaction but is never written back. **`destroy()` produces zero writes** — a StrictMode unmount must not wipe storage.

Two lanes drive the same setters: the passive **persister** (above), and reactive stores. A reactive source of truth (router search params, a global store) should drive the setters directly (`facet.setSelected`, `rows.setSelectedValues`, `hist.setRange`); the persister is for passive storage only. Do not wire both to the same state.

`resetAll` across N filters produces N per-entry `write` calls — coalesce/debounce consumer-side if a single storage commit is wanted.

For wiring either lane behind a router — `navigate({ search })` in `write`, `reason` → push/replace, driving the setters from reactive search params, and coalescing the per-client fan-out — see the [router persistence recipe](../react/router-persistence.md).

## Lifecycle

- `setEnabled(false)` defers queries (and the initial load) until re-enabled — for offscreen views.
- `destroy()` removes the client's published clauses, unwires Params/Selections, and disconnects from the coordinator. It is idempotent, and `client.destroyed` reports it (framework bindings use this for remount detection).
- `mosaicClient` exposes the wrapped upstream `MosaicClient` for coordinator/vgplot interop; vgplot marks are Mosaic clients too and share the same Selection graph with no extra machinery.
