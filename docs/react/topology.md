# Topology bindings

React bindings for the [selection-topology](../core/selection-topology.md) primitive: build one topology from a declarative config, distribute it through a provider, and let widgets resolve their Selections by name.

The core object does all the work (construction, validation, reset, active-clause enumeration, teardown). These bindings are thin: `useTopology` owns the instance's React lifecycle, and a deliberately dumb provider/consumer pair distributes it without prop-drilling.

## `useTopology`

`useTopology(config, options?)` constructs a [`Topology`](../core/selection-topology.md) and owns its lifecycle inside React: lazy construction, teardown on unmount, and StrictMode-safe single-wiring. The `options` bag carries the code-only core fields (`selections`, `filterSets`, and the [param](../core/selection-topology.md#params) fields `params` / `paramOptions`) plus an optional `initialize(topology)` callback that runs once for each newly-created topology before the hook returns it. `initialize` is intended for application-owned bootstrap state that must be present before querying children mount; changing only the callback identity never recreates a live topology.

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

### Hoist or memoize the config and options fields

Recreation is keyed on the **identities** of `config`, `options.selections`, `options.filterSets`, `options.params`, and `options.paramOptions` — not on the options bag object itself, and not on `initialize`. A change to any of those references tears the previous topology down and builds a fresh one. The options bag itself may be built inline every render (e.g. `{ ...coreOptions, initialize }`), and `initialize`'s identity never recreates — only the config and the `selections` / `filterSets` / `params` / `paramOptions` fields need a stable identity. Keep those references stable — hoist to module scope (the common case, since a page's topology is static), or `useMemo` / a ref when the shape genuinely depends on props:

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

An inline `useTopology({ … }, { selections: { … } })` literal mints a new `config` (and `selections`) identity every render, which would rebuild the topology (and re-wire every relay) on each render — the same contract the Phase-1 composition hooks (`useComposedSelection`, `useCascadingContexts`) document. The bag wrapper itself is exempt: `useTopology(config, { ...options, initialize })` with a stable `config` and stable `selections` / `filterSets` / `params` / `paramOptions` stays stable even though the bag is a fresh object each render.

The [`params`](../core/selection-topology.md#params) and `paramOptions` fields participate in the recreation key exactly like `selections` / `filterSets`: a mid-life identity change tears the previous topology down and builds a fresh one (resolving the newly-supplied external param instances). Supply them from a stable reference — hoist or memoize alongside `config` — so the topology stays stable across re-renders, and only swap the identity when you intend to rebuild.

### Seed bootstrap state in `initialize`

State the page restores at load — Param values and filter specs read from the URL, a saved view, or a server-provided default — belongs in `initialize`, not in a child's `useEffect`. `initialize` runs before the hook returns the topology, so before any querying child mounts: every client's first query is built from the seeded state and nothing re-queries.

```tsx
import { useTopology } from '@nozzleio/react-mosaic';
import type { Topology } from '@nozzleio/react-mosaic';

const config = {
  filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
  from: { type: 'param', default: '2024-01-01' },
  to: { type: 'param', default: '2024-12-31' },
} as const;

function Page({ saved }: { saved: { from: string; to: string } | null }) {
  const topology = useTopology(config, {
    initialize: (created: Topology) => {
      if (saved === null) {
        return;
      }
      // Params first, then the clause (see "One query per action").
      created.resolveParam('from').update(saved.from);
      created.resolveParam('to').update(saved.to);
      created.getFilterSet('filters')?.set({
        id: 'date',
        column: 'day',
        kind: 'interval',
        value: saved.from,
        valueTo: saved.to,
      });
    },
  });
  // …
}
```

Seeding after children mount lands as a change on clients that are already initializing. Upstream `Coordinator.updateSelection` waits for such a client's initial query and then issues a second one — usually with the same predicate, since the initial query was built after the seed — and each seeded Param re-queries the client again a batch later. The result is correct but the database runs each query twice or more. (Clients whose `filterBy` is [coalesced](../core/concepts.md#one-query-per-action) skip the selection-driven repeat, but Params seeded late still re-query.)

`initialize` runs once per created topology, so it re-seeds after a recreation (a new `config` identity, StrictMode's simulated remount). Persisted state that already has a home — a FilterSet's or Param's own `persist` — hydrates itself at construction and needs no `initialize` step.

### Teardown on unmount

Unmounting (or rebuilding) a `useTopology` owner destroys the topology **silently**: owned compose/cascading contexts and FilterSets detach without publishing clear clauses. React runs effect cleanups **parent-first**, so the clients of a `useMosaicValues` / `useMosaicRows` / … child are still connected to the topology's Selections when the parent's cleanup destroys the topology — and an app cannot reorder its own effects to change that. A clearing teardown would make every such child run one unfiltered query on its way out (each then rejected and logged if the coordinator is being cleared too); silent teardown issues none. The children's own cleanups then disconnect their clients as usual.

To opt back into the clearing teardown, pass `clearOnDestroy: true` in the options bag (`useTopology(config, { ...options, clearOnDestroy: true })`). Like `initialize`, it is not a recreation key — it is read when each topology is constructed. See [teardown is silent](../core/selection-topology.md#teardown-is-silent) for the core semantics, and the [connector lifecycle recipe](./connector-lifecycle.md#teardown-order) for where the coordinator and its DuckDB worker fit in the teardown order.

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

`topology` also accepts `null`, an explicit boundary for a subtree whose topology is not ready yet. It shadows any outer provider, so the provider-consuming hooks below it throw the same error as with no provider at all, instead of resolving a parent page's topology. Gate those hooks on readiness.

### `useMosaicTopology`

Return the topology from the nearest provider. Throws a clear error outside a provider, or below one given `topology={null}` (a topology is a required page-scope object, so there is no sensible default).

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

Resolved Selections are owned by the topology's React lifecycle, so their identity changes when the topology is recreated — including on StrictMode's simulated remount in dev. Hooks that resolve per render pick the change up automatically; anything that **captures** a resolved Selection at build time must be told to rebuild. For vgplot this is the `deps` argument of [`useVgPlot`](./use-vg-plot.md) (from `@nozzleio/react-mosaic/vgplot`) — pass every topology-resolved Selection the plot factory closes over (`useVgPlot(factory, [$brush, $context])`), or the plot keeps publishing into a destroyed topology's Selection: it still filters (relays survive) but its clauses are invisible to `activeClauses` and `reset()`.

To retrieve a FilterSet by entry name, reach through the topology object rather than a ref (a FilterSet is compound and has no bare ref):

```tsx
const topology = useMosaicTopology();
const filterSet = topology.getFilterSet('filters');
```

### `useMosaicParamRef`

`useMosaicParamRef<T>(ref)` — sugar over `useMosaicTopology`: resolve a bare ref to its [`Param<T>`](../core/selection-topology.md#params) through the provided topology — the param mirror of `useMosaicSelectionRef`. Throws (via `topology.resolveParam`, listing `validNames`) on an undeclared ref, a dotted ref (params have no children), or a ref to a selection-flavored entry (directing back to `resolve`). The `T` type parameter defaults to `any`, so `useMosaicParamRef<MedalMetric>('metric')` types the result without a cast.

Use it to hand a declared param to a client's `params` — the value-less handle, resolved from the same string ref a `param` entry carries in a spec:

```tsx
import { useMosaicParamRef, useMosaicValues } from '@nozzleio/react-mosaic';
import { Query, column, sum } from '@uwdata/mosaic-sql';

function MedalKpi() {
  const $metric = useMosaicParamRef('metric');
  const kpis = useMosaicValues<{ medals: number }>({
    query: ({ where }) =>
      Query.from('athletes')
        .select({ medals: sum(column($metric.value!)) })
        .where(where),
    params: { metric: $metric }, // re-queries when the param changes
  });
  return <div>{kpis.values?.medals}</div>;
}
```

To render the param's live value (a display, or a controlled input), read it with [`useMosaicParamValue`](./hooks.md#param-read-back) — or several at once with [`useMosaicParamValues`](./hooks.md#param-read-back).

`useMosaicParamRef` (like `useMosaicSelectionRef`) throws on a bad ref. To check a ref without throwing — a spec-driven widget whose param is optional — test `topology.validNames.has(ref)` or look it up in `topology.params[ref]` (via `useMosaicTopology()`) first.

## Active-clause hooks

Two thin store-subscription hooks over [`topology.activeClauses`](../core/selection-topology.md#active-clauses). Each returns the annotated foreign clauses (`Array<ActiveClause>`) and rerenders when they change. Annotation passthrough only — no chip model, grouping, or label-map logic lives here; those are app concerns (see the [recipes](./topology-recipes.md)).

- **`useTopologyActiveClauses(topology)`** — subscribe to a topology you already hold. Accepts `null` / `undefined` while the topology is not available yet and then returns a stable, frozen empty array without subscribing.
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
