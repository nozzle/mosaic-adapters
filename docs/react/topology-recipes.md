# Topology recipes

Consumer-side patterns over a [`Topology`](../core/selection-topology.md): a page-wide **reset**, an **active-filters / chips** bar, and a **param → selection bridge**. Each is a few lines of app code over the topology object's consumer surfaces — the `reset()` action, the `activeClauses` observation, and the resolvers. None ships in any package: the chip model, its grouping, the union, and the clause-minting below are exactly where apps differ, so they live here and in the example apps.

The reference implementation for both is [`examples/react/nozzle-paa/src/topology.ts`](../../examples/react/nozzle-paa/src/topology.ts).

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
    const chips: Array<ActiveFilterChip> = filterSetChips.map(
      (chip: FilterSetChip) => ({
        key: `fs:${chip.key}`,
        label: chip.label,
        value: chip.formattedValue,
        target: chip.target,
        operator: chip.operator,
        foreign: false,
        remove: () => filterSet.removeChip(chip),
      }),
    );

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
- **Foreign removal is a null-predicate publish.** Clearing the whole clause means publishing `{ source, value: null, predicate: null }` from the clause's own source onto its owning Selection. `Selection.remove(source)` does **not** clear a `single` Selection's clause, so the null-predicate publish is the form that works across every resolution type. Per-value narrowing (removing one value from a multi-value clause) stays a FilterSet concern.

## Param → selection bridge

A [`param`](../core/selection-topology.md#params) is a scalar knob: it shapes _what a query computes_ by value interpolation, and it never mints a `WHERE` / `HAVING` predicate. Sometimes an app wants a control that is **both** — a value read by some queries _and_ a filter clause published onto a Selection (a "minimum medals" threshold, a "top-N as a filter"). Minting a clause from a scalar is publish-side, precisely like a FilterSet chip: its shape is where apps differ, so the packages deliberately **do not ship it**. The packages give you the resolver ([`useMosaicParamRef`](./topology.md#usemosaicparamref)) and the read hook ([`useMosaicParamValue`](./hooks.md#param-read-back)); the bridge is these few lines of app code.

The widget reads the param's scalar value and publishes a clause into a sibling Selection under a stable source, so the clause updates in place and clears as a whole clause on [`reset()`](../core/selection-topology.md#reset-semantics) or from a chip bar:

```tsx
import { useEffect, useMemo } from 'react';
import {
  useMosaicParamRef,
  useMosaicParamValue,
  useMosaicSelectionRef,
} from '@nozzleio/react-mosaic';
import { sql } from '@uwdata/mosaic-sql';

// Config declares the knob and the Selection it filters into:
//   minMedals: { type: 'param', default: 0 },
//   where: { type: 'crossfilter' },

function MinMedalsFilter() {
  const $minMedals = useMosaicParamRef('minMedals');
  const $where = useMosaicSelectionRef('where');
  const value = useMosaicParamValue<number>($minMedals) ?? 0;

  // A stable clause source identifies this bridge's clause on $where, so a new
  // value replaces the previous clause in place rather than stacking.
  const source = useMemo(() => ({ id: 'min-medals-bridge' }), []);

  // The bridge: whenever the scalar changes, mint (or clear) a predicate
  // clause. This is the publish step the packages leave to the app.
  useEffect(() => {
    $where.update({
      source,
      value,
      predicate: value > 0 ? sql`"medals" >= ${value}` : null,
    });
  }, [$where, source, value]);

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
- [Filter set](../core/filter-set.md) — the chip model (`useFilterSetChips`) the FilterSet half of the union uses.
- Sibling React recipes: [connector lifecycle](./connector-lifecycle.md), [data loading](./data-loading.md), [filter editor](./filter-editor.md).
