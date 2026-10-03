# Data client concepts

`@nozzleio/mosaic-core` is a headless Mosaic client library. Its central primitive is the **data client**: a SQL query factory plus native Mosaic Selections/Params in, a reactive typed store out. A page is a graph of clients sharing a coordinator and communicating via Selections; tables, charts, KPI cards, and filter chips are thin renderers of client output.

The mental model is "React Query for Mosaic": serializable intent flows in (sorting, pagination — plain JSON), data flows out (rows, totals, records). Every data operation executes in SQL.

## The query factory

Every client is fed by a `QuerySource`: a table name, a table reference, or a factory receiving a `QueryContext`. A plain string is always one table identifier: `'main.events'` renders `FROM "main.events"` and logs a development-only warning. For a schema-qualified table, pass `new TableRefNode(['main', 'events'])` from `@uwdata/mosaic-sql`, which renders `FROM "main"."events"`. `tableRef('main', 'events')` from this package builds the same node (see [mosaic-sql helpers](./sql-helpers.md)). A `string[]` is rejected, because mosaic-sql renders it as a cross join. The React hooks compare sources with `isSameQuerySource(a, b)`: table references compare by SQL form, strings and factories by identity. Factories cover everything else:

```ts
const client = createRowsClient({
  coordinator,
  query: ({ where, having }) => Query.from('athletes').select('id', 'name', 'sport').where(where),
  filterBy: $page, // native Selection → WHERE
  havingBy: $agg, // native Selection → HAVING (our extension; upstream is WHERE-only)
});
```

- `where` is `filterBy.predicate(client)` — already self-excluded under cross-filtering. It is `[]` when unfiltered, so `.where(where)` needs no guard.
- `having` is the same for `havingBy`. Predicate validity in HAVING position (aggregate references) is the caller's responsibility.
- `inputs` is the current inputs object; only consume it with `inputMode: 'manual'`.

A factory that drops `where` or `having` while it carries an active predicate silently shows unfiltered data. In development, the client warns once when that happens — see [ignored-filter warning](#ignored-filter-warning).

The factory is held by **latest-ref** (React-Query `queryFn` style): a new function identity never re-queries. Swap it with `client.setQuery(fn)`; the next trigger uses the latest factory. This structurally eliminates function-identity re-query bugs. When the swapped factory is a genuinely new query (recompiled pivot columns, a rule set, picked columns), say so with `client.invalidate()` — see [re-query triggers](#re-query-triggers).

## Re-query triggers

Exactly five things trigger a query:

1. **Inputs change** — `setInputs(patch)` merge-patches and value-diffs; a value-equal patch is a no-op, a changed patch issues exactly one query.
2. **Selection updates** — `filterBy` via the native coordinator wiring (or, when the client cannot pre-aggregate, the client's own wiring — see [one query per action](#one-query-per-action)); `havingBy` via the client's own wiring. Passing the same Selection as both routes its predicate into both WHERE and HAVING on a single re-query per activation (rarely what you want; prefer a separate Selection for aggregate predicates).
3. **Param change** — every Param in `params` re-queries the client on its `'value'` event (upstream never does this automatically).
4. **`refetch()`** — force a query with current state. It queries immediately and also resets query-derived memos (the rows client re-issues its `rowCount: 'query'` COUNT), because the underlying data may have changed. Use it after replacing the data.
5. **`invalidate()`** — the query itself changed: re-query with the current factory, inputs and filters. Call it after `setQuery(...)` with a recompiled factory. Unlike `refetch()`, it is coalesced like an inputs change (an `invalidate()` in the same tick as a `setInputs` issues one query) and keeps query-derived memos, which already key on the SQL they derive from (a recompiled query whose COUNT SQL changed re-counts on its own). While the client is disabled, the re-query runs once it is enabled. In React, the hooks' [`queryKey`](../react/hooks.md#re-querying-a-compiled-query-querykey) option calls it for you.

The input-driven triggers (`setInputs`, Param and `havingBy` `'value'` events, and `filterBy` `'value'` events on clients that cannot pre-aggregate) and `invalidate()` are **coalesced**: a burst of synchronous changes in one tick collapses into a single query build (the last state wins) instead of one query per event. In a visible browser tab this rides upstream `requestUpdate()`, which throttles on an animation frame. Browsers pause animation frames in hidden tabs, so while `document.visibilityState === 'hidden'` (and in environments without `requestAnimationFrame`, such as Node) the client falls back to a macrotask flush with the same one-build-per-tick semantics, and re-queries triggered in a background tab still complete. `status` still flips to `'pending'` synchronously so loading stays responsive. `refetch()` bypasses coalescing and queries immediately.

### One query per action

A single user action often writes a Selection clause **and** Params — a date-range brush that sets a range filter plus `$from`/`$to` Params a query interpolates. How many queries that sends depends on which path the client's `filterBy` takes.

**Clients that cannot pre-aggregate** — `filterStable: false` (the default or forced value for the facet, sparkline, rollup and pivot clients) or a non-empty [`skipSources`](#per-widget-filter-scoping) — re-query `filterBy` changes through the same coalesced batch as Params, `havingBy` and `setInputs`. A clause and a Param written in the same tick, in either order, build **one** query carrying both. Two smaller differences from upstream come with it: a `filterBy` change while the client is still initializing (its `prepare` step pending) is answered by the initial query alone instead of a second query after it, and the Selection's latest resolved clause list is read when the query is built. A batch holding only `filterBy` changes is issued the way upstream `Coordinator.updateSelection` issues a standard selection update, so it leaves the coordinator's pre-aggregation state — and every pre-aggregating sibling's materialized table — in place; a batch that also carries a Param, `havingBy`, `setInputs` or `invalidate()` change goes through upstream `Coordinator.requestQuery`, which clears that state, exactly as the Param's own re-query always has. The trade-off is one animation frame of latency on brush-driven re-queries in a visible tab, where upstream queries synchronously. Opt a client back into upstream's immediate path with `coalesceFilterBy: false`:

```ts
const sparkline = createSparklineClient({
  coordinator,
  from: 'events',
  filterBy: $page,
  // keep upstream's synchronous Coordinator.updateSelection re-query
  coalesceFilterBy: false,
  // …
});
```

**Clients that can pre-aggregate** — `filterStable` left on (the default for rows, values and histogram clients) and no `skipSources` — keep upstream `Coordinator.updateSelection` unchanged: it is what feeds Mosaic's pre-aggregation optimizer, so `coalesceFilterBy` has no effect on them, and coalesced siblings' brush-driven re-queries do not discard their pre-aggregated tables. This follows the client's own `filterStable` / `skipSources`, not the coordinator: disabling pre-aggregation on the coordinator does not move a `filterStable: true` client onto the coalesced path. Selection changes re-query immediately there, while Param changes re-query one batch later, so the write order matters:

- **Write the Params first, then the clause.** The clause's immediate query is built after the Params changed, so it already reads their new values. When that query is the client's ordinary query, the Param's batched re-query produces the identical SQL, and the coordinator's query cache (on by default) answers it without a second database round trip.
- Clause first, then Params, sends **two** different queries: the clause's query with the old Param values, then the Param's re-query with the new ones. The screen ends up correct, but the database runs both.

The cache only merges requests whose SQL is identical, so Params first does not reach one query when upstream's optimizer answers the clause from a pre-aggregated table (pre-aggregation enabled on the coordinator — the upstream default — and an aggregate query with a clause the optimizer can index). The clause's query then reads the materialized table (built first if needed), while the Param's batched re-query goes through upstream `Coordinator.requestQuery`, which clears the optimizer's state, and queries the base table. The two statements differ, so both reach the database in either write order, and the next clause change rebuilds the materialized table. That is upstream's behavior for any Param change on such a client; if a combined clause-and-Param action is frequent and pre-aggregation is not paying off for that client, `filterStable: false` puts it on the coalesced path above.

```ts
// Params first: one database query on coalesced clients, and on pre-aggregating
// clients whose clause query is not answered from a pre-aggregated table.
$from.update(range.from);
$to.update(range.to);
filterSet.set({
  id: 'date',
  column: 'day',
  kind: 'interval',
  value: range.from,
  valueTo: range.to,
});
```

Writing Params first is harmless on coalesced clients, so it is the safe default for app code that does not know which path every consumer takes. For state restored at page load, seed it before any client connects instead — see [seeding in `initialize`](../react/topology.md#seed-bootstrap-state-in-initialize).

### The current-request guarantee

Every trigger supersedes whatever main query was still in flight. Only the response to the **most recent** request writes `status`/data to the store; a response for an older request — whether it succeeds or fails, and whichever order the responses arrive in — is dropped. So while filter A's query is still running and filter B's query is issued, the store stays `'pending'` until B answers, rather than briefly reporting `'success'` with A's rows against B's `inputs`. A build that yields no query (`buildQuery` returns `null`) counts as the current request too: its empty payload is final and any late result is discarded. Nothing is cancelled at the connector — the older query still runs to completion in the database — the guarantee is about what the store advertises.

The guarantee also holds for a query that interpolates a live Param (``sql`… ${param}` `` anywhere in the query, or `column(param)`), which would otherwise re-render with the Param's newest value each time it is stringified. The client freezes each request at the Param values it was built with: the SQL sent to the database (on its own or merged by query consolidation), the SQL its result is cached under, `lastQuery`, and a failed request's `QueryError.sql` all keep the build-time text. A Param change can therefore never make an older request's failure or cancellation count as the newer request's. Your own query object is not modified and keeps rendering live.

## The store

Every client exposes a `@tanstack/store` `Store`. The base shape:

```ts
{
  status: 'idle' | 'pending' | 'success' | 'error',
  error: Error | null,
  inputs: TInputs,          // inputs the last *built* main query was built from — never a source of truth
  lastQuery: string | null, // SQL of the last *built* main query (observability)
  settled: { inputs: TInputs; query: string | null } | null, // what the payload on screen answers
}
```

Specializations add their payload (`rows`/`totalRows`, `values`). Read `store.state`, subscribe with `store.subscribe`.

When you call `coordinator.query()` yourself, read its result (an Arrow table, or an array from a JSON connector) with the same helpers the clients use: `toResultRows(result)` returns row objects, `firstResultRow(result)` returns the first row (read with `.get(0)`, without materializing the rest) or `undefined`, and `resultRowCount(result)` returns `numRows` or the array length.

### Built vs settled

`inputs` and `lastQuery` are written when a query is **built**, so while a re-query is pending they already describe the new request — but the payload in the store is still the previous response (the store keeps the old rows until the new ones arrive). `settled` is the provenance of that payload: the `inputs` and SQL of the request whose response (or empty round) produced it.

- `settled` is `null` until the first successful response or empty round.
- It moves only when the current request succeeds. A failed, cancelled or superseded request leaves it — and the payload — untouched.
- An empty round (`buildQuery` returns `null`) settles with `query: null`, matching `lastQuery: null`.

Two derivations follow:

```ts
const { status, settled, lastQuery } = client.store.state;

// Never loaded yet (vs. loaded but empty, which has `settled !== null`).
const isInitialLoading = status === 'pending' && settled === null;

// The payload answers an older query than the last one built
// (a re-query is pending, or it failed and the old rows are still shown).
const isStale = settled !== null && settled.query !== lastQuery;
```

**Pre-aggregation caveat.** A response the client did not build the SQL for has `settled.query === null` — notably selection updates answered by the coordinator's pre-aggregation path, which queries a materialized view instead of the client's query (the first such update, which creates the view, included; if a pre-aggregated query fails and upstream retries with the client's own query, that response carries its SQL again, as does an update with no active clause, such as after `Selection.reset()`, which upstream answers with the client's own query). The optimizer also builds the client's query to analyze it, which moves `lastQuery` without issuing it. When pre-aggregation can apply (a `filterBy` Selection, `filterStable` left on, and the coordinator's pre-aggregation enabled), guard the stale check with `settled.query !== null`, or compare `settled.inputs` instead when only inputs matter.

### Query errors and cancellation

With Mosaic 0.30+, a main-query failure sets `error` to the upstream
`QueryError` class. Narrow it with `instanceof QueryError` (imported from
`@uwdata/mosaic-core`) to inspect `.sql`, the SQL the coordinator actually
issued, and `.cause`, the underlying database error. `Error | null` remains the
public state type because non-client paths are not all wrapped; notably,
[`createSchemaClient`](./schema-client.md) runs `queryFieldInfo` through
`coordinator.query()` directly and can surface a plain `Error`.

`QueryError.message` embeds the whole SQL query (`"<cause>\n\nSQL Query: …"`),
so don't render it directly. `describeQueryError(error)` splits any error value
into display-ready parts — `{ message, sql?, cause? }`, where for a `QueryError`
`message` is the underlying cause's message and `sql` the issued query — and
returns `null` for `null`/`undefined`, so it accepts a store's `error` as-is:

```ts
import { describeQueryError } from '@nozzleio/mosaic-core';

const failure = describeQueryError(client.store.state.error);
if (failure) {
  showError(failure.message, failure.sql); // sql is undefined for non-QueryErrors
}
```

**Cancellation is not an error.** `coordinator.cancel(requests)` and
`coordinator.clear()` (with or without `clients`) reject in-flight requests with
Mosaic's bare `'Canceled'`/`'Cleared'` reasons. When that hits a client's
current main query, the store does **not** move to `'error'`: `status` stays
`'pending'` and `error` keeps its previous value until the next
[trigger](#re-query-triggers) re-queries the client. A client disconnected by
`clear({ clients: true })` is never triggered again, so it stays `'pending'`
until it is destroyed (in React, keying the tree on the
[connection identity](../react/connector-lifecycle.md#why-key-by-connection-identity)
remounts it against a fresh coordinator). [`createSchemaClient`](./schema-client.md) is not a data
client and still reports a cancelled field-info query as its `error`. A cancelled request
that was already superseded is dropped like any other stale response (see
[the current-request guarantee](#the-current-request-guarantee)). The
coordinator's logger still receives the wrapped `QueryError`, as upstream does.

For the promise-returning paths you call yourself (`coordinator.query()`,
`coordinator.exec()`), use `isQueryCancellation(error)` instead of
string-matching those reasons. It is `true` for the bare `'Canceled'` or
`'Cleared'` string, an `Error` with that message, and a `QueryError` whose
`cause` is either — for example to retry a load that a
[connector reset](../react/data-loading.md#sequential-exec-with-a-cleared-retry)
cleared. Both helpers are exported from `@nozzleio/mosaic-core` and re-exported
by `@nozzleio/react-mosaic`.

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
  query: ({ where }) => Query.from('events').select({ total: count() }).where(where),
  filterBy: $page,
  skipSources: new Set(['date_range']),
});
```

Matching is by the stable id a clause's source carries (`clause.source.id`) — the same id a [filter set](./filter-set.md) spec is keyed by. One spec can fan out to several clauses (an aggregate-threshold emits a `having:` clause plus `members:` clauses); skipping the id drops **all** of that spec's clauses from the Selection being resolved. A clause whose source carries no string `id` is never skipped.

Skipping composes on top of everything else the Selection's resolver does: crossfilter self-exclusion still applies, and union / intersect / `empty` semantics are preserved — resolution delegates to the Selection's own resolver rather than a hand-rolled one. An absent or empty set is byte-identical to not passing the option.

Skipping happens **in front of the coordinator**, not just while building SQL: the client subscribes to a derived Selection that never carries a skipped clause (`createSkipProjectedSelection`, a [mapped Selection](./selection-topology.md#mapped-selections) using the same relay mechanism as `include` / composed Selections). A change to a skipped source is therefore not a re-query trigger at all — no request is issued and `status` never leaves `'success'` — while a change to any kept clause, `setInputs`, a Param, or `refetch()` refreshes as usual. The same applies to `havingBy`. The derivation follows both relayed `update()` calls and the parent's emitted `'value'`, so a parent that publishes whole snapshots (a mapped projection Selection, or upstream `clone()`/`remove()`) is honoured too; in that path the effective list is compared by content — source, predicate SQL and `clients` — so fresh clause objects with unchanged meaning do not re-query.

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

## Debugging

### Client `meta`

`meta` is a consumer-owned bag of debugging metadata — a widget id, a label, a route. The library never reads it and it never reaches the query:

```ts
const kpi = createValuesClient({
  coordinator,
  query: ({ where }) => Query.from('events').select({ total: count() }).where(where),
  filterBy: $page,
  meta: { widget: 'kpi-total' },
});

kpi.meta; // { widget: 'kpi-total' }
kpi.setMeta({ widget: 'kpi-total', route: '/overview' }); // never re-queries
```

It is held by **latest-ref**: `setMeta` replaces it without re-querying, and the React hooks sync their `meta` option the same way (a new `meta` never recreates the client). The client also mirrors it onto the wrapped upstream `MosaicClient` under the registered symbol `MOSAIC_CLIENT_META`, so coordinator-level observers — which only ever see `MosaicClient`s — can attribute each query to the widget that issued it. Read it with `getClientMeta`, which returns `undefined` for any client without one (vgplot marks, plain `makeClient` clients):

```ts
import { getClientMeta } from '@nozzleio/mosaic-core';

const updateClient = coordinator.updateClient.bind(coordinator);
coordinator.updateClient = (client, query, priority) => {
  console.debug(getClientMeta(client)?.widget ?? '(unknown)', String(query));
  return updateClient(client, query, priority);
};
```

The mirror is a non-enumerable getter that always returns the latest `meta`. A query log or devtools panel is out of scope for this package; `meta` is the hook such a tool needs.

### `previewQuery()`

`client.previewQuery()` builds the SQL the client would issue for its current filters and inputs — **without issuing anything**: no request, no store update, no COUNT side-channel query. It returns `{ main, count }`:

- `main` — the main query, or `null` when the client would issue none (an empty round, such as a sparkline client with no keys and no `filterBy`).
- `count` — the rows client's separate COUNT query with `rowCount: 'query'`; `null` for every other client and row-count mode (`'window'` counts inside `main`).

Every part can be overridden; overrides are not applied to the client:

```ts
rows.previewQuery(); // what refetch() would issue right now
rows.previewQuery({ inputs: { offset: 50 } }); // the next page (merged over current inputs)
rows.previewQuery({ where: [] }); // ...as if unfiltered
rows.previewQuery({ where: eq('sport', literal('swim')), having: [] });
```

It is a **debugging and testing aid**: the SQL text is whatever `@uwdata/mosaic-sql` renders, and its exact format is not stable across versions — assert on fragments, not whole strings. It throws when the client cannot build yet (a histogram before its extent is discovered), and your query factory runs as it would for a real query, so any side effects of its own still happen.

### Ignored-filter warning

In development, a client warns once (`console.warn`, with its `meta` attached when set) if its query factory was handed an active `where` or `having` predicate and **never read it** — the query it built silently ignores that filter:

```ts
// Warns: `where` is never read, so the page filter is ignored.
query: () => Query.from('events').select({ total: count() }),
```

It only fires when there is something to ignore: an unfiltered client, a predicate that is empty because of cross-filter self-exclusion, and a table-name `query` (the client applies both predicates itself) never warn. Reads are detected by property access, so destructuring or spreading the context counts as reading both predicates. If dropping a predicate is deliberate, read it to acknowledge (`void ctx.where`) — or, to render a widget fully unfiltered, omit `filterBy`. `previewQuery()` never warns.

"Development" means `process.env.NODE_ENV` is set and not `'production'`. Bundlers replace that expression, so the check is stripped from production builds; where nothing sets it (an unbundled browser, a plain Node script) the warning stays off.

## Lifecycle

- `setEnabled(false)` defers queries (and the initial load) until re-enabled — for offscreen views.
- `destroy()` removes the client's published clauses, unwires Params/Selections, and disconnects from the coordinator. It is idempotent, and `client.destroyed` reports it (framework bindings use this for remount detection).
- `mosaicClient` exposes the wrapped upstream `MosaicClient` for coordinator/vgplot interop; vgplot marks are Mosaic clients too and share the same Selection graph with no extra machinery.
