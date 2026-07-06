# Topology bindings

React bindings for the [selection-topology](../core/selection-topology.md) primitive: build one topology from a declarative config, distribute it through a provider, and let widgets resolve their Selections by name.

The core object does all the work (construction, validation, reset, active-clause enumeration, teardown). These bindings are thin: `useTopology` owns the instance's React lifecycle, and a deliberately dumb provider/consumer pair distributes it without prop-drilling.

## `useTopology`

`useTopology(config, options?)` constructs a [`Topology`](../core/selection-topology.md) and owns its lifecycle inside React: lazy construction, teardown on unmount, and StrictMode-safe single-wiring.

```tsx
import { useTopology } from '@nozzleio/react-mosaic';

const topologyConfig = {
  where: { type: 'crossfilter' },
  brush: { type: 'single', label: 'Brush' },
  detail: { type: 'compose', include: ['where', 'brush'] },
} as const;

function Page() {
  const topology = useTopology(topologyConfig);
  // …
}
```

### Hoist or memoize the config and options

Recreation is keyed on the **identity** of `config` and `options`, not their structural contents. A change to either object reference tears the previous topology down and builds a fresh one. Keep both references stable — hoist to module scope (the common case, since a page's topology is static), or `useMemo` / a ref when the shape genuinely depends on props:

```tsx
// Module scope — one stable identity for the page's lifetime.
const config = {
  where: { type: 'crossfilter' },
  filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
} as const;

const options = {
  filterSets: { filters: { kinds: customKinds, persist: urlPersister } },
};

function Page() {
  const topology = useTopology(config, options);
  // stable across every re-render; destroyed on unmount
}
```

An inline `useTopology({ … }, { … })` literal mints a new config identity every render, which would rebuild the topology (and re-wire every relay) on each render — the same contract the Phase-1 composition hooks (`useComposedSelection`, `useCascadingContexts`) document.

## Provider and consumer hooks

`MosaicTopologyProvider` distributes **one** topology instance to descendants. It is deliberately dumb — it holds a single instance and has no registry semantics of its own; construction, validation, and teardown all live on the topology object.

```tsx
import { MosaicTopologyProvider, useTopology } from '@nozzleio/react-mosaic';

function Page() {
  const topology = useTopology(config, options);
  return (
    <MosaicTopologyProvider topology={topology}>
      <Dashboard />
    </MosaicTopologyProvider>
  );
}
```

### `useMosaicTopology`

Return the topology from the nearest provider. Throws a clear error outside a provider (a topology is a required page-scope object, so there is no sensible default).

```tsx
import { useMosaicTopology } from '@nozzleio/react-mosaic';

function ClearAllButton() {
  const topology = useMosaicTopology();
  return <button onClick={() => topology.reset()}>Clear all</button>;
}
```

### `useMosaicSelectionRef`

Sugar over `useMosaicTopology`: resolve a ref to its Selection through the provided topology. Throws (via `topology.resolve`, listing `validNames`) on an undeclared or bare-compound ref — the same contract as calling `resolve` directly.

```tsx
import { useMosaicSelectionRef, useMosaicValues } from '@nozzleio/react-mosaic';
import { Query, count } from '@uwdata/mosaic-sql';

function KpiCard() {
  const $detail = useMosaicSelectionRef('detail');
  const kpis = useMosaicValues<{ n: number }>({
    query: ({ where }) => Query.from('paa').select({ n: count() }).where(where),
    filterBy: $detail,
  });
  return <div>{kpis.values?.n}</div>;
}
```

This is the spec-driven wiring in one line: a widget spec carries a string ref (`filterBy: 'detail'`), and the widget resolves it against the provided topology at mount.

Resolved Selections are owned by the topology's React lifecycle, so their identity changes when the topology is recreated — including on StrictMode's simulated remount in dev. Hooks that resolve per render pick the change up automatically; anything that **captures** a resolved Selection at build time must be told to rebuild. For vgplot this is `useVgPlot`'s `deps` argument — pass every topology-resolved Selection the plot factory closes over (`useVgPlot(factory, [$brush, $context])`), or the plot keeps publishing into a destroyed topology's Selection: it still filters (relays survive) but its clauses are invisible to `activeClauses` and `reset()`.

To retrieve a FilterSet by entry name, reach through the topology object rather than a ref (a FilterSet is compound and has no bare ref):

```tsx
const topology = useMosaicTopology();
const filterSet = topology.getFilterSet('filters');
```

## Active-clause hooks

Two thin store-subscription hooks over [`topology.activeClauses`](../core/selection-topology.md#active-clauses). Each returns the annotated foreign clauses (`Array<ActiveClause>`) and rerenders when they change. Annotation passthrough only — no chip model, grouping, or label-map logic lives here; those are app concerns (see the [recipes](./topology-recipes.md)).

- **`useTopologyActiveClauses(topology)`** — subscribe to a topology you already hold.
- **`useMosaicActiveClauses()`** — the provider-consuming variant; resolves the topology from the nearest provider, then delegates.

```tsx
import { useMosaicActiveClauses } from '@nozzleio/react-mosaic';

function ForeignChips() {
  const clauses = useMosaicActiveClauses();
  return (
    <>
      {clauses.map((c) => (
        <span key={c.ref}>{c.label ?? c.entry}</span>
      ))}
    </>
  );
}
```

For the full active-filter bar — unioning these foreign clauses with a FilterSet's spec-derived chips into one chip shape — see the [active-filters recipe](./topology-recipes.md#active-filters--chips).

## Hand-written topology stays first-class

The declarative form is additive, not a replacement. The [Selection helper hooks](./hooks.md#topology-helpers) (`useMosaicSelection`, `useMosaicSelections`, `useComposedSelection`, `useCascadingContexts`) are untouched and share the same underlying composition logic as `createTopology`, so a hand-wired page and a declared page behave identically. Reach for `useTopology` when widgets need to reference Selections **by name** (spec-driven pages); reach for the helper hooks when you hold the Selection instances directly.

## See also

- [Selection topology (core)](../core/selection-topology.md) — the full declaration vocabulary, ref grammar, validation, reset, and active-clause semantics.
- [Topology recipes](./topology-recipes.md) — page-wide reset and the active-filters / chips union.
- [React hooks](./hooks.md#topology-helpers) — the hand-written Selection helper hooks.
