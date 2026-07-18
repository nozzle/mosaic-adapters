# React bindings

`@nozzleio/react-mosaic` binds the [data clients](../core/concepts.md) to React. Install this package only — it re-exports the full `@nozzleio/mosaic-core` public API (the `@tanstack/react-table` distribution model; the core is a regular dependency, never a peer).

## Provider setup

Hooks resolve their coordinator in order: explicit `coordinator` option → nearest `MosaicProvider` → upstream Mosaic's global default coordinator (the one bare vgplot calls use).

```tsx
import { Coordinator } from '@uwdata/mosaic-core';
import { MosaicProvider } from '@nozzleio/react-mosaic';

const coordinator = new Coordinator(connector);

<MosaicProvider coordinator={coordinator}>
  <App />
</MosaicProvider>;
```

The library ships `MosaicProvider` and stops there — connector choice, retry, reconnect, and keying page state to the connection are app policy. For that app-owned lifecycle (a `ConnectorProvider`, connection-identity keying on reconnect, and the vgplot `createAPIContext` gotcha), see the [connector lifecycle recipe](./connector-lifecycle.md); for loading tables into the coordinator, the [data loading recipe](./data-loading.md).

## The hooks

Every client has a controlled-binding hook: `useMosaicRows`, `useMosaicValues`, `useMosaicFacet`, `useMosaicHistogram`, `useMosaicSparkline`, `useMosaicRollup`, `useMosaicPivot`, and `useMosaicSchema`. Each takes the client options (minus the now-optional `coordinator`) and returns the client's store state spread together with the client instance:

```tsx
const athletes = useMosaicRows<AthleteRow>({
  query: ({ where }) =>
    Query.from('athletes').select('id', 'name', 'sport', 'weight').where(where),
  filterBy: $page,
  inputs: {
    orderBy: sortingToOrderBy(sorting),
    ...paginationToWindow(pagination),
  },
  rowCount: 'window',
  publish: { select: { as: $picked, columns: ['id'] } },
});

// athletes.rows, athletes.totalRows, athletes.status, athletes.error,
// athletes.lastQuery, athletes.client (imperative: selectRows, hoverRow,
// prefetch, refetch)

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

1. **Structural identity** — `coordinator`, `filterBy`, `havingBy`, `skipSources` (a set, compared order-insensitively by its ids), `params` (each Param instance), `publish` (Selections, columns, throttle — or, for the `into` form, the [filter set](../core/filter-set.md) identity plus `id`/`kind`/`label`), `persist`, `inputMode`, `filterStable`, `rowCount`, and each client's query-shape options (`column`, `arrayColumn`, `counts`, `sort`, `select`, `extent`, `key`, `x`/`y`, `on`, `using`, `groupBy`, `in` — plain JSON, compared by value). Changing any of these destroys the client and creates a new one (fresh store, new first query). Keep them stable — module scope, `useState`, or `useMemo`. `persist` is structural because a new persister identity means a new storage location, so recreate + re-hydrate is correct. The persister must be module-scope or memoized: an inline `persist: { read, write }` literal mints a new identity on every render, and each recreated client's store update rerenders the hook — effectively a render loop (recreate, query, rerender, recreate). For persisting behind a router — driving the setters from reactive search params, or wiring a persister over `navigate` — see the [router persistence recipe](./router-persistence.md).
2. **Latest-ref** — `query`/`from` and `coerce` (React-Query `queryFn` style). New function identities never recreate the client and never re-query; the next query, whatever triggers it, is built from the latest functions. Inline closures are free.
3. **Value-diffed** — `inputs` is compared by value and forwarded through `setInputs`; a value-equal object with fresh identity is a no-op. The option fully owns the inputs: a key present on the previous render and absent now is cleared. `enabled` forwards through `setEnabled` (e.g. `useMosaicFacet({ enabled: open })` queries options only while a dropdown is open).

Re-query triggers are exactly: inputs change, Selection activation, Param change, `refetch()`.

## Status semantics

The hooks report React-Query semantics: while `enabled`, a client that has not completed its first query reports `'pending'` from the very first render; `'idle'` surfaces only while `enabled: false`. (The core store itself stays `'idle'` until the first query actually starts — the hook derives the difference.)

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

- `useMosaicSelectionValue<T>(selection, { source? })` — reactively read a Selection's clause value: the read-back half of clause publishing. Scope by `source` (e.g. a rows client's stable `publish.select.source`) on multi-publisher Selections; returns `null` when no matching clause is active. This is how a widget renders its own published selection (in-widget chips, checkmarks) from the same Selection its siblings consume.
- `useFilterSetState(filterSet)` / `useFilterSetChips(filterSet)` — subscribe to a [filter set](../core/filter-set.md)'s specs/chips. The set itself is a long-lived page-scope object created next to the Selections; components only subscribe and call its setters (`set`, `remove`, `removeChip`, `reset`).

## Param read-back

- `useMosaicParamValue<T>(param)` — reactively read a [`Param`](../core/selection-topology.md#params)'s current value: the read-back half of param publishing, mirroring `useMosaicSelectionValue`. A control that drives a topology-owned Param (a threshold slider, a mode toggle) renders its own live value from the same Param its siblings consume, so an external change (another control, a page reset) is reflected without extra wiring. Returns `undefined` when the param has never been given a value; re-subscribes when a different Param instance is passed.

Like `useMosaicSelectionValue`, it takes an **instance**, not a ref — so it serves a hand-built `Param.value(...)` outside any topology as readily as one resolved from a topology. Inside a topology, resolve the Param first with [`useMosaicParamRef`](./topology.md#usemosaicparamref):

```tsx
import { useMosaicParamRef, useMosaicParamValue } from '@nozzleio/react-mosaic';

function MetricToggle() {
  const $metric = useMosaicParamRef('metric');
  const metric = useMosaicParamValue<string>($metric);
  return (
    <select
      value={metric ?? 'gold'}
      onChange={(e) => $metric.update(e.target.value)}
    >
      <option value="gold">Gold</option>
      <option value="silver">Silver</option>
      <option value="bronze">Bronze</option>
    </select>
  );
}
```
