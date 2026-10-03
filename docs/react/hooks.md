# React bindings

`@nozzleio/react-mosaic` binds the [data clients](../core/concepts.md) to React. Install this package only — it re-exports the full `@nozzleio/mosaic-core` public API (the `@tanstack/react-table` distribution model; the core is a regular dependency, never a peer).

## Provider setup

Hooks resolve their coordinator in order: explicit `coordinator` option → nearest `MosaicProvider` → upstream Mosaic's global default coordinator (the one bare vgplot calls use). The global fallback applies only when there is **no** `MosaicProvider` above the hook at all.

```tsx
import { Coordinator } from '@uwdata/mosaic-core';
import { MosaicProvider } from '@nozzleio/react-mosaic';

const coordinator = new Coordinator(connector);

<MosaicProvider coordinator={coordinator}>
  <App />
</MosaicProvider>;
```

### `coordinator={null}`: an explicit boundary

A subtree that is not ready yet — a nested dashboard whose connection is still loading, a preview pane — can pass `coordinator={null}` to stop the lookup. Without it, hooks below would silently resolve a parent provider's coordinator, or the global one:

```tsx
function NestedDashboard() {
  const { coordinator } = useNestedConnection(); // Coordinator | null while loading
  return (
    <MosaicProvider coordinator={coordinator}>
      {coordinator === null ? <Spinner /> : <Dashboard />}
    </MosaicProvider>
  );
}
```

Any hook that resolves its coordinator below a `null` provider throws a clear `[react-mosaic]` error. Gate the data hooks on readiness (as above), or give a hook an explicit `coordinator` option, which always wins over the boundary. A nested `MosaicProvider` holding a coordinator re-opens resolution for its own subtree.

Gate on readiness by not rendering the hook — `enabled: false` is not enough. A hook with `enabled: false` still creates (and connects) its client during render; `enabled` only defers querying. So an `enabled: false` hook below a `null` provider throws too.

The library ships `MosaicProvider` and stops there — connector choice, retry, reconnect, and keying page state to the connection are app policy. For that app-owned lifecycle (a `ConnectorProvider`, connection-identity keying on reconnect, and binding vgplot plots to the provided coordinator), see the [connector lifecycle recipe](./connector-lifecycle.md); for loading tables into the coordinator, the [data loading recipe](./data-loading.md).

## The hooks

Every client has a controlled-binding hook: `useMosaicRows`, `useMosaicValues`, `useMosaicFacet`, `useMosaicHistogram`, `useMosaicSparkline`, `useMosaicRollup`, `useMosaicPivot`, and `useMosaicSchema`. Each takes the client options (minus the now-optional `coordinator`) and returns the client's store state spread together with the client instance:

```tsx
const athletes = useMosaicRows<AthleteRow>({
  query: ({ where }) => Query.from('athletes').select('id', 'name', 'sport', 'weight').where(where),
  filterBy: $page,
  inputs: {
    orderBy: sortingToOrderBy(sorting),
    ...paginationToWindow(pagination),
  },
  rowCount: 'window',
  publish: { select: { as: $picked, columns: ['id'] } },
});

// athletes.rows, athletes.totalRows, athletes.selected (published select
// tuples), athletes.status, athletes.error, athletes.lastQuery,
// athletes.settled, athletes.client (imperative: selectRows,
// setSelectedValues, hoverRow, prefetch, refetch, invalidate)

const kpis = useMosaicValues<{ athletes: number; medals: number }>({
  query: ({ where }) =>
    Query.from('athletes')
      .select({ athletes: count(), medals: sum('gold') })
      .where(where),
  filterBy: $page,
});
```

## The three option-identity rules

How a hook reacts to an option change depends on which of three classes the option is in. The rule of thumb: **every option with a core setter is diffed into that setter; everything else is structural.**

1. **Structural identity** — `coordinator`, `filterBy`, `havingBy`, `skipSources` (a set, compared order-insensitively by its ids), `params` (each Param instance), `publish` (Selections, columns, throttle — or, for the `into` form, the [filter set](../core/filter-set.md) identity plus `id`/`kind`/`label`), `persist`, `inputMode`, `filterStable`, [`coalesceFilterBy`](../core/concepts.md#one-query-per-action), `rowCount`, and each client's query-shape options (`column`, `columnPaths`, `arrayColumn`, `counts`, `sort`, `select`, `extent`, `key`, `x`/`y`, `on`, `using`, `groupBy`, `in` — plain JSON, compared by value). Changing any of these destroys the client and creates a new one (fresh store, new first query). Keep them stable — module scope, `useState`, or `useMemo`. `persist` is structural because a new persister identity means a new storage location, so recreate + re-hydrate is correct. The persister must be module-scope or memoized: an inline `persist: { read, write }` literal mints a new identity on every render, and each recreated client's store update rerenders the hook — effectively a render loop (recreate, query, rerender, recreate). For persisting behind a router — driving the setters from reactive search params, or wiring a persister over `navigate` — see the [router persistence recipe](./router-persistence.md).
2. **Latest-ref** — `query`/`from` and `coerce` (React-Query `queryFn` style). New function identities never recreate the client and never re-query; the next query, whatever triggers it, is built from the latest functions. Inline closures are free. A `TableRefNode` source is compared by its SQL string form, so `from: new TableRefNode(['main', 'events'])` built inline on every render is the same source.
3. **Value-diffed** — `inputs` is compared by value and forwarded through `setInputs`; a value-equal object with fresh identity is a no-op. The option fully owns the inputs: a key present on the previous render and absent now is cleared. `enabled` forwards through `setEnabled` (e.g. `useMosaicFacet({ enabled: open })` queries options only while a dropdown is open).

Re-query triggers are exactly: inputs change, Selection activation, Param change, `refetch()`, and a `queryKey` change (`client.invalidate()`).

## Re-querying a compiled query (`queryKey`)

Latest-ref is right for inline closures, but an app that **compiles** its query — pivot columns, a rule set, a column picker — needs a way to say "this is a new query". Every data-client hook (`useMosaicRows`, `useMosaicValues`, `useMosaicFacet`, `useMosaicHistogram`, `useMosaicSparkline`, `useMosaicRollup`, `useMosaicPivot`) takes an optional `queryKey` deps array. List the values the query is compiled from; when one changes, the hook calls [`client.invalidate()`](../core/concepts.md#re-query-triggers):

```tsx
const query = useMemo(() => compileQuery(columns, rules), [columns, rules]);

const table = useMosaicRows<Row>({
  query,
  filterBy: $page,
  inputs,
  queryKey: [columns, rules],
});
```

- Compared element-wise with `Object.is` against the previous render — the same contract as [`useVgPlot`](./use-vg-plot.md) deps. A fresh array with the same elements is no change; keep the elements stable (state, `useMemo`) or use primitives.
- Adding or removing the key counts as a change: going from an array to `undefined` (or back) re-queries, so `queryKey: cond ? [a] : undefined` re-queries on every toggle. Keep it an array and vary its elements instead.
- The first render never re-queries (the initial query already uses the latest factory), and neither does a render that recreates the client through a structural option.
- The key is applied after `inputs`, so a key change in the same render as an inputs change is **one** query.
- Prefer it over calling `refetch()` from an effect: `refetch()` is immediate, so next to an inputs change it issues the main query twice, and it re-runs the rows client's COUNT query even when the count cannot have changed. Keep `refetch()` for "the data changed".
- Omitted, nothing changes: a new `query` never re-queries on its own.
- Wrapping a hook? The option's type is exported as `QueryKeyOptions`.

## Status semantics

The hooks report React-Query semantics: while `enabled`, a client that has not completed its first query reports `'pending'` from the very first render; `'idle'` surfaces only while `enabled: false`. (The core store itself stays `'idle'` until the first query actually starts — the hook derives the difference.)

`status` alone does not say whether the data on screen belongs to the current query: during a re-query it is `'pending'` while the previous rows are still shown, and `inputs`/`lastQuery` already describe the new request. Use `settled` (see [built vs settled](../core/concepts.md#built-vs-settled)):

```ts
const isInitialLoading = table.status === 'pending' && table.settled === null;
const isStale = table.settled !== null && table.settled.query !== table.lastQuery;
```

## Lifecycle

Clients are created once per mount and destroyed on unmount; StrictMode's double-mount destroys the first client and transparently recreates it (connect/disconnect stay symmetric — no dangling coordinator clients). The client is created disabled during render and enabled after commit, so the first query belongs to the mounted component. Publishing clients (facet, histogram, rows) clear their published clauses on unmount.

## Topology helpers

- `useMosaicSelection(type?)` — one stable `Selection` (memoized on `type`, default `'intersect'`); the singular case most consumers reach for first — `filterBy`/`havingBy` wiring and a pub/sub channel between sibling widgets. For full control drop to `const [selection] = useState(() => Selection.single())`; the hook is preferred because it guarantees stable identity and a consistent surface.
- `useMosaicSelections(keys, type?)` — batch-create stable Selections for a set of inputs.
- `useComposedSelection(selections, options?)` — one Selection that mirrors the AND of the given Selections (relay-linked, seeded, cleaned up on unmount). `options.as` picks the resolution strategy (`'intersect'`, default, or `'crossfilter'` for per-client self-exclusion); changing it rebuilds the composite.
- `useCascadingContexts(inputs, externals?)` — peer-minus-self contexts for facet inputs: each input's context includes every _other_ input plus the externals, so a dropdown is filtered by everything except its own value.

For a topology known up front, prefer composing statically at module scope with upstream-native `Selection.intersect({ include: [...] })` — the hooks above exist for graphs assembled inside React lifecycles.

When widgets need to reference selections **by name** (spec-driven pages, hand-editable dashboard configs), declare the whole graph as data with [`useTopology`](./topology.md) instead of passing instances around — the hooks above stay first-class and share the same composition logic. See [Selection topology](../core/selection-topology.md).

## Selection read-back and chips

- `useMosaicSelectionValue<T>(selection, { source? })` — reactively read a Selection's clause value: the read-back half of clause publishing. Scope by `source` (e.g. a rows client's stable `publish.select.source`) on multi-publisher Selections; returns `null` when no matching clause is active. The subscription is keyed on the Selection instance; a changed `source` (or a fresh options object) is applied at read time without re-subscribing. This is how a widget renders its own published selection (in-widget chips, checkmarks) from the same Selection its siblings consume.
- `useFilterSetState(filterSet)` / `useFilterSetChips(filterSet)` — subscribe to a [filter set](../core/filter-set.md)'s specs/chips. The set itself is a long-lived page-scope object created next to the Selections; components only subscribe and call its setters (`set`, `remove`, `removeChip`, `reset`). Both accept `null` / `undefined` while the set is not available yet and then return the empty state (`{ specs: [], chips: [] }` / `[]`, stable and frozen) without subscribing.

## Param read-back

- `useMosaicParamValue<T>(param)` — reactively read a [`Param`](../core/selection-topology.md#params)'s current value: the read-back half of param publishing, mirroring `useMosaicSelectionValue`. A control that drives a topology-owned Param (a threshold slider, a mode toggle) renders its own live value from the same Param its siblings consume, so an external change (another control, a page reset) is reflected without extra wiring. Returns `undefined` when the param has never been given a value; the subscription is keyed on the instance, so it re-subscribes only when a different Param instance is passed (not on every render).

Like `useMosaicSelectionValue`, it takes an **instance**, not a ref — so it serves a hand-built `Param.value(...)` outside any topology as readily as one resolved from a topology. Inside a topology, resolve the Param first with [`useMosaicParamRef`](./topology.md#usemosaicparamref):

```tsx
import { useMosaicParamRef, useMosaicParamValue } from '@nozzleio/react-mosaic';

function MetricToggle() {
  const $metric = useMosaicParamRef('metric');
  const metric = useMosaicParamValue<string>($metric);
  return (
    <select value={metric ?? 'gold'} onChange={(e) => $metric.update(e.target.value)}>
      <option value="gold">Gold</option>
      <option value="silver">Silver</option>
      <option value="bronze">Bronze</option>
    </select>
  );
}
```

- `useMosaicParamValues(params)` — the record form: read several Params in one subscription. Pass a `Record<string, Param>` and get back `{ [key]: value | undefined }`, each entry typed from its Param (`ParamValueOf<Param<T>>` is `T`). Entries are each Param's `value` as upstream reports it: `undefined` when never set, and an explicit `null` stays `null` (the singular `useMosaicParamValue` keeps its existing `null` → `undefined` normalization). The returned snapshot is frozen and keeps its identity while every value is `Object.is`-equal, so it is safe as a hook dependency. `params` **must be memoized** (module scope, `useMemo`, or `topology.params` itself) — the same contract as a client's `params` / `inputs`; the subscription is keyed on the record's identity, so an inline literal re-subscribes every render.

```tsx
import { useMemo } from 'react';
import { useMosaicParamValues, useMosaicTopology } from '@nozzleio/react-mosaic';

function KnobSummary() {
  const { params } = useMosaicTopology();
  const knobs = useMemo(() => ({ metric: params.metric!, threshold: params.threshold! }), [params]);
  const { metric, threshold } = useMosaicParamValues(knobs);
  return (
    <span>
      {metric} ≥ {threshold}
    </span>
  );
}
```

`topology.params` is typed `Record<string, Param<any>>`, so the `!` above is only safe for params the topology declares. To fail loudly on a mistyped name instead, resolve each entry with [`useMosaicParamRef`](./topology.md#usemosaicparamref), which throws on an unknown ref.
