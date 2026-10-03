# Topology recipes

Consumer-side patterns over a [`Topology`](../core/selection-topology.md): a page-wide **reset**, an **active-filters / chips** bar, a **custom-chart brush**, and a **param → selection bridge**. Each is a few lines of app code over the topology object's consumer surfaces — the `reset()` action, the `activeClauses` observation, the resolvers, and the [FilterSet](../core/filter-set.md) setters. None ships in any package: the chip model, its grouping, the union, the brush UI, and the clause-minting below are exactly where apps differ, so they live here and in the example apps.

The reference implementation for the reset and the chip bar is [`examples/react/nozzle-paa/src/topology.ts`](../../examples/react/nozzle-paa/src/topology.ts).

## Page-wide reset

`topology.reset()` is already type-aware ([reset semantics](../core/selection-topology.md#reset-semantics)): it clears `standalone` and `external` entries, delegates `filter-set` entries to `filterSet.reset()`, and skips derived (`compose` / `cascading`) and `reset: false` entries. So a "Clear all" button is one call:

```tsx
import { useMosaicTopology } from '@nozzleio/react-mosaic';

function ClearAllButton() {
  const topology = useMosaicTopology();
  return <button onClick={() => topology.reset()}>Clear all</button>;
}
```

The declaration types carry the ownership, so you never enumerate selections by hand. Opt a selection out of the sweep — a scope filter that must survive "clear all", or a derived read-context that holds no clauses of its own — with `reset: false` in the config:

```ts
const config = {
  where: { type: 'crossfilter' }, // cleared
  scope: { type: 'single', reset: false }, // survives clear-all
  brush: { type: 'external', reset: false }, // an app-owned instance clear-all must not touch
} as const;
```

(Derived `compose` / `cascading` read-contexts are skipped automatically — they hold no clauses of their own — so they never need `reset: false`.)

This replaces the pre-rewrite "selection registry for reset-all" — there is no standalone React-context registry, only a method on the topology object.

## Active filters / chips

An active-filter bar has to render **two** sources as one list:

1. **FilterSet chips** — spec-derived, from [`useFilterSetChips`](./hooks.md). Each carries its own label, formatted value, resolved target, and operator; removal narrows or drops the spec.
2. **Foreign clauses** — clauses on topology-owned Selections the FilterSet did _not_ source (transient vgplot brushes, direct-to-Selection `publish.as`), from [`useMosaicActiveClauses`](./topology.md#active-clause-hooks). The [core dedup](../core/selection-topology.md#active-clauses) already excludes FilterSet-sourced clauses, so this set is exactly the genuinely foreign one.

The union normalizes both to one app-local chip shape. The shape is yours — this is the exact recipe from the example:

```tsx
import { useMemo } from 'react';
import {
  useFilterSetChips,
  useMosaicActiveClauses,
  useMosaicTopology,
} from '@nozzleio/react-mosaic';
import type { FilterSet, FilterSetChip } from '@nozzleio/react-mosaic';

interface ActiveFilterChip {
  key: string;
  label: string;
  value: string;
  target: string; // placement badge: resolved routing target / entry ref
  operator: string | undefined;
  foreign: boolean; // true for a non-FilterSet clause — cleared as a whole clause
  remove: () => void;
}

function useActiveFilters(filterSet: FilterSet): Array<ActiveFilterChip> {
  const topology = useMosaicTopology();
  const filterSetChips = useFilterSetChips(filterSet);
  const foreignClauses = useMosaicActiveClauses();

  return useMemo(() => {
    // 1. FilterSet chips — narrow/drop the spec on remove.
    const chips: Array<ActiveFilterChip> = filterSetChips.map((chip: FilterSetChip) => ({
      key: `fs:${chip.key}`,
      label: chip.label,
      value: chip.formattedValue,
      target: chip.target,
      operator: chip.operator,
      foreign: false,
      remove: () => filterSet.removeChip(chip),
    }));

    // 2. Foreign clauses — clear the WHOLE clause on remove. Each surfaces
    // exactly once: shared read-contexts are declared `compose` entries, which
    // core excludes from active-clause observation, so no context relays a
    // duplicate report of the base source's clause.
    for (const active of foreignClauses) {
      chips.push({
        key: `foreign:${active.ref}`,
        label: active.label ?? active.entry, // the declaration's `label`
        value: formatForeignValue(active.clause.value),
        target: active.ref,
        operator: undefined,
        foreign: true,
        remove: () => {
          // Publish a null predicate from the clause's own source: clears every
          // resolution type, including `single` (where Selection.remove(source)
          // would not). Per-value narrowing stays a FilterSet concern.
          topology.resolve(active.ref).update({
            source: active.clause.source,
            value: null,
            predicate: null,
            fields: [],
          });
        },
      });
    }
    return chips;
  }, [topology, filterSet, filterSetChips, foreignClauses]);
}
```

### Two things to get right

The example's inline comments call these out; they are the whole reason this is a recipe and not a package export.

- **Each foreign clause surfaces once — no dedup needed.** Declare shared crossfilter read-contexts as [`compose`](../core/selection-topology.md#self-excluding-crossfilter-composites) entries (`as: 'crossfilter'`), not `external` hand-wired composites. Core excludes `compose` / `cascading` contexts from active-clause observation, so a foreign clause relayed into a read-context is never re-reported — it appears exactly once, on its base source. (An observed `external` composite that relays would double-report; that is the reason to prefer `compose`.)
- **Label from the annotation.** A foreign clause has no spec, so its human label comes from the declaration's `label` (and/or `meta`) surfaced on the [`ActiveClause`](../core/selection-topology.md#active-clauses) — e.g. the example declares `spotlight: { type: 'single', label: 'Domain Spotlight', meta: { column: 'domain' } }` and reads both back.
- **Foreign removal is a null-predicate publish.** Clearing the whole clause means publishing `{ source, value: null, predicate: null, fields: [] }` from the clause's own source onto its owning Selection. `Selection.remove(source)` does **not** clear a `single` Selection's clause, so the null-predicate publish is the form that works across every resolution type. Per-value narrowing (removing one value from a multi-value clause) stays a FilterSet concern.

## Custom-chart brush

A brush drawn by a chart that is not vgplot — a Recharts/visx/ECharts time series, a hand-rolled SVG — needs no adapter. The brush is an `interval` [FilterSpec](../core/filter-set.md#the-model) written into the page's FilterSet, with the chart's own client in `clients`:

```ts
filterSet.set(
  { id: 'signup-date', column: 'created_at', kind: 'interval', value: [lo, hi] },
  { clients: new Set([client.mosaicClient]) },
);
filterSet.remove('signup-date'); // clear the brush
```

Because the brush is a spec rather than a raw clause, the FilterSet gives it what a managed widget gets:

- **Persistence.** It is serialized with the rest of the set (`persist`, URL state, [router persistence](./router-persistence.md)) and hydrates through the same `set()` path.
- **Chips.** It appears in [`useFilterSetChips`](./hooks.md) and the [active-filters bar](#active-filters--chips) with its `label`, formatted as `lo – hi`. A chip's X (`removeChip`), `filterSet.reset()` and a [page-wide reset](#page-wide-reset) of a topology that declares the set all remove it.
- **Self-exclusion.** `clients` puts the chart's `mosaicClient` on the published clause, so under a `Selection.crossfilter()` the brush filters every other consumer while the chart keeps drawing its full domain.

Read the brush back with `useFilterSetState(filterSet)` rather than keeping a copy in component state. Then a hydrated brush, a chip removal or a page reset all redraw the chart's selection with no extra wiring.

If the chart is a histogram, prefer [`useMosaicHistogram`](../core/histogram-client.md) with `publish: { into: filterSet, id }`. It writes the same `interval` spec and handles the remount re-keying below for you. The recipe is for charts the packages do not model.

```tsx
import { useEffect } from 'react';
import { useFilterSetState, useMosaicRows } from '@nozzleio/react-mosaic';
import type { FilterSet, FilterSpec } from '@nozzleio/react-mosaic';
import type { MosaicClient, Selection } from '@uwdata/mosaic-core';
import { Query, count, dateBin } from '@uwdata/mosaic-sql';

const BRUSH_ID = 'signup-date';

/** Snapping is app policy: whole UTC days here. */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The brush's `[lo, hi]` ISO bounds, or `null` when no brush is active. */
function readBrush(specs: ReadonlyArray<FilterSpec>): [string, string] | null {
  const spec = specs.find((candidate) => candidate.id === BRUSH_ID);
  if (spec === undefined || !Array.isArray(spec.value)) {
    return null;
  }
  const [lo, hi] = spec.value as Array<unknown>;
  if (typeof lo !== 'string' || typeof hi !== 'string') {
    return null;
  }
  return [lo, hi];
}

function SignupsChart({ filterSet, $where }: { filterSet: FilterSet; $where: Selection }) {
  const series = useMosaicRows<{ day: Date; signups: number }>({
    query: ({ where }) =>
      Query.from('signups')
        .select({ day: dateBin('created_at', 'day'), signups: count() })
        .where(where)
        .groupby('day')
        .orderby('day'),
    filterBy: $where,
    coerce: { day: 'date', signups: 'number' },
  });
  const { client } = series;

  // Read-back: hydrated, chip-removed and reset brushes all land here.
  const { specs } = useFilterSetState(filterSet);
  const brush = readBrush(specs);

  useReattachBrush(filterSet, $where, client, BRUSH_ID);

  const onBrushEnd = (extent: [Date, Date] | null) => {
    if (extent === null) {
      filterSet.remove(BRUSH_ID);
      return;
    }
    filterSet.set(
      {
        id: BRUSH_ID,
        column: 'created_at',
        kind: 'interval',
        label: 'Signed up',
        value: [startOfUtcDay(extent[0]).toISOString(), startOfUtcDay(extent[1]).toISOString()],
      },
      { clients: new Set([client.mosaicClient]) },
    );
  };

  // Your chart component: draws `brush` and reports the dragged extent.
  return <MyTimeSeries data={series.rows} selection={brush} onBrushEnd={onBrushEnd} />;
}
```

- **Temporal bounds are ISO strings.** A spec must survive `JSON.parse(JSON.stringify(spec))` (the [round-trip rule](../core/filter-set.md#serializable-state)), so convert `Date`s with `toISOString()` and let DuckDB cast the literals: a full ISO timestamp for `TIMESTAMP` columns, `YYYY-MM-DD` for `DATE` columns. Parse them back with `new Date(iso)` when drawing.
- **Snapping stays in the app.** The `interval` kind publishes the bounds it is given. Rounding to a day, a bin edge or a minimum width happens before `set()`, so the persisted spec, the chip and the SQL all show the snapped range.
- **`clients` is session state.** It is never persisted. A spec hydrated from storage has no `clients` until the chart re-keys it, and `useReattachBrush` below does that on mount.

### Re-keying across a remount

The spec outlives the chart: an enlarge/return move or a StrictMode remount leaves it in the set, still keyed to the previous mount's (destroyed) `mosaicClient`. The new client does not match that clause's `clients`, so its first query is filtered by its own brush. Re-key the spec to the live client on mount, then refetch once the re-keyed clause reaches `filterBy`. The refetch is needed because Mosaic skips re-querying a client for a clause that excludes it, so the stale first result would otherwise stay on screen. The check runs on `filterBy`'s `value` event because the update can be queued behind an in-flight dispatch, and queries read the last emitted clauses:

```ts
function useReattachBrush(
  filterSet: FilterSet,
  filterBy: Selection,
  client: { readonly mosaicClient: MosaicClient; refetch: () => Promise<void> },
  id: string,
): void {
  useEffect(() => {
    const spec = filterSet.store.state.specs.find((candidate) => candidate.id === id);
    if (spec === undefined) {
      return;
    }
    const mosaicClient = client.mosaicClient;
    let done = false;
    const refetchOnceSelfExcluded = (): void => {
      if (done) {
        return;
      }
      const selfExcluded = filterBy.clauses.some((clause) => clause.clients?.has(mosaicClient));
      if (!selfExcluded) {
        return;
      }
      done = true;
      filterBy.removeEventListener('value', refetchOnceSelfExcluded);
      void client.refetch();
    };
    // Listen first: an unqueued update emits synchronously inside set().
    filterBy.addEventListener('value', refetchOnceSelfExcluded);
    filterSet.set(spec, { clients: new Set([mosaicClient]) });
    refetchOnceSelfExcluded();
    return () => {
      done = true;
      filterBy.removeEventListener('value', refetchOnceSelfExcluded);
    };
  }, [filterSet, filterBy, client, id]);
}
```

The built-in publishing clients (`useMosaicFacet`, `useMosaicHistogram`, `useMosaicRows`) do this internally under `publish.into`. Unmounting the chart does not clear its brush. If the brush should end with the chart, call `filterSet.remove(BRUSH_ID)` in an unmount cleanup.

### Raw clauses need a stable source

You can skip the FilterSet and publish clauses straight onto a Selection, as the [param bridge](#param--selection-bridge) below does. In that case each entry needs a **stable** `source` object. A Selection keys clauses by `source` identity: an update replaces the clause from the same source and appends one from a new source. A source created per mount (`useMemo`, `useRef`, an inline literal) therefore leaves the previous mount's clause in place after a remount. That ghost clause keeps filtering the page, and no mounted component will update or clear it. (A `single` Selection keeps only its newest clause, so it is not affected.) Create one source per entry at module scope (or wherever the Selection itself lives), never per component instance. A FilterSet already does this: it mints one stable source per `(spec.id, target)` pair.

## Param → selection bridge

A [`param`](../core/selection-topology.md#params) is a scalar knob: it shapes _what a query computes_ by value interpolation, and it never mints a `WHERE` / `HAVING` predicate. Sometimes an app wants a control that is **both** — a value read by some queries _and_ a filter clause published onto a Selection (a "minimum medals" threshold, a "top-N as a filter"). Minting a clause from a scalar is publish-side, precisely like a FilterSet chip: its shape is where apps differ, so the packages deliberately **do not ship it**. The packages give you the resolver ([`useMosaicParamRef`](./topology.md#usemosaicparamref)) and the read hook ([`useMosaicParamValue`](./hooks.md#param-read-back)); the bridge is these few lines of app code.

The widget reads the param's scalar value and publishes a clause into a sibling Selection under a stable source, so the clause updates in place and clears as a whole clause on [`reset()`](../core/selection-topology.md#reset-semantics) or from a chip bar:

```tsx
import { useEffect } from 'react';
import {
  useMosaicParamRef,
  useMosaicParamValue,
  useMosaicSelectionRef,
} from '@nozzleio/react-mosaic';
import { sql } from '@uwdata/mosaic-sql';

// Config declares the knob and the Selection it filters into:
//   minMedals: { type: 'param', default: 0 },
//   where: { type: 'crossfilter' },

// A stable clause source identifies this bridge's clause on $where, so a new
// value replaces the previous clause in place rather than stacking. Module
// scope, not per mount: a remount must replace the clause, not leave a ghost
// beside it (see "Raw clauses need a stable source" above).
const MIN_MEDALS_SOURCE = { id: 'min-medals-bridge' };

function MinMedalsFilter() {
  const $minMedals = useMosaicParamRef('minMedals');
  const $where = useMosaicSelectionRef('where');
  const value = useMosaicParamValue<number>($minMedals) ?? 0;

  // The bridge: whenever the scalar changes, mint (or clear) a predicate
  // clause. This is the publish step the packages leave to the app.
  useEffect(() => {
    $where.update({
      source: MIN_MEDALS_SOURCE,
      value,
      predicate: value > 0 ? sql`"medals" >= ${value}` : null,
      fields: [], // a raw SQL predicate holds no column nodes
    });
  }, [$where, value]);

  // The input still drives the param itself — other queries read it via `params`.
  return (
    <input
      type="number"
      min={0}
      value={value}
      onChange={(event) => $minMedals.update(event.target.valueAsNumber)}
    />
  );
}
```

Two things this makes explicit:

- **The param stays the source of truth.** The input writes the scalar; the bridge derives a clause from it. A KPI that aggregates under this threshold reads the same `minMedals` param through its client's `params` — the knob and the filter never drift.
- **The published clause is an ordinary foreign clause.** Because it lands on `where` under its own source, it surfaces in [`activeClauses`](../core/selection-topology.md#active-clauses) and clears with the [null-predicate publish](#active-filters--chips) like any other foreign clause — the bridge did not create a new removal path.

## See also

- [Selection topology (core)](../core/selection-topology.md) — reset, active-clause, and [param](../core/selection-topology.md#params) semantics.
- [Topology bindings (React)](./topology.md) — `useTopology`, provider/consumer hooks, active-clause hooks.
- [Filter set](../core/filter-set.md) — the chip model (`useFilterSetChips`) the FilterSet half of the union uses, and the `interval` kind the custom-chart brush writes.
- Sibling React recipes: [connector lifecycle](./connector-lifecycle.md), [data loading](./data-loading.md), [filter editor](./filter-editor.md).
