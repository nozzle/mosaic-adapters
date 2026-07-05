/**
 * App-side glue over the declared page topology (see {@link page-context}).
 *
 * The page builds ONE {@link Topology} from the hoisted {@link topologyConfig} +
 * {@link paaTopologyOptions} via {@link useTopology}, distributes it through a
 * {@link MosaicTopologyProvider}, and exposes three thin accessors widgets use
 * instead of importing Selection instances:
 *
 * - {@link usePaaFilterSet} — the page FilterSet (`filters` entry).
 * - {@link usePaaContexts} — the crossfilter read-contexts (`page`,
 *   `summaryFilterBy:<card>`), wired lazily on first use.
 * - {@link useActiveFilters} — the app-side recipe unioning FilterSet chips with
 *   the topology's foreign clauses (see below).
 */
import { useMemo } from 'react';
import {
  useFilterSetChips,
  useMosaicActiveClauses,
  useMosaicTopology,
  useTopology,
} from '@nozzleio/react-mosaic';
import {
  FILTERS_ENTRY,
  isDerivedContextRef,
  paaTopologyOptions,
  topologyConfig,
  wirePaaContexts,
} from './page-context';
import type { PaaContexts } from './page-context';
import type {
  FilterSet,
  FilterSetChip,
  Topology,
} from '@nozzleio/react-mosaic';

/** Build the page topology (stable object identity → one topology for the page). */
export function usePaaTopology(): Topology {
  return useTopology(topologyConfig, paaTopologyOptions);
}

/** The page FilterSet, resolved from the provided topology. */
export function usePaaFilterSet(): FilterSet {
  const topology = useMosaicTopology();
  const filterSet = topology.getFilterSet(FILTERS_ENTRY);
  if (filterSet === undefined) {
    throw new Error(
      `[nozzle-paa] no FilterSet is declared for entry '${FILTERS_ENTRY}'.`,
    );
  }
  return filterSet;
}

/**
 * The crossfilter read-contexts, resolved + wired from the provided topology.
 * `wirePaaContexts` is idempotent per topology, so this is a stable object for
 * the topology's lifetime.
 */
export function usePaaContexts(): PaaContexts {
  const topology = useMosaicTopology();
  return useMemo(() => wirePaaContexts(topology), [topology]);
}

// ── useActiveFilters: the app-side union recipe (issue #181 §6) ──────────────

/**
 * A unified active-filter chip — the shape the active-filter bar renders. Both
 * FilterSet-derived chips (spec/kind clauses) and foreign clauses (Selections
 * the FilterSet does not own) normalize to this. Deliberately app-local: the
 * chip model, its grouping, and this union are exactly where apps differ, so
 * they live here, not in any package.
 */
export interface ActiveFilterChip {
  /** Stable react key. */
  key: string;
  /** Short human label (`Domain`, `Search Vol`, `Domain Spotlight`, …). */
  label: string;
  /** Human-readable value string. */
  value: string;
  /** Placement badge source: the resolved routing target / entry ref. */
  target: string;
  /** The kind/condition operator, when the source declares one. */
  operator: string | undefined;
  /** True for a foreign (non-FilterSet) clause — cleared as a whole clause. */
  foreign: boolean;
  /** Remove this filter (narrow a FilterSet chip, or clear the whole clause). */
  remove: () => void;
}

/** True when `value` is a `{ column }` annotation the spotlight source carries. */
function readColumn(meta: unknown): string | undefined {
  if (typeof meta === 'object' && meta !== null && 'column' in meta) {
    const column = (meta as { column?: unknown }).column;
    return typeof column === 'string' ? column : undefined;
  }
  return undefined;
}

/** Formats a foreign clause's value for display (arrays comma-joined). */
function formatForeignValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(', ');
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

/**
 * The active-filter-bar recipe: union the FilterSet's spec-derived chips with
 * the topology's genuinely foreign clauses, both normalized to
 * {@link ActiveFilterChip}.
 *
 * - **FilterSet chips** (`useFilterSetChips` → `filterSet.store`) carry their own
 *   label / value / resolved target / operator; removal narrows or drops the
 *   spec (`removeChip`).
 * - **Foreign clauses** (`useMosaicActiveClauses`) are clauses on
 *   topology-owned Selections the FilterSet does NOT source — here, the
 *   `spotlight` single Selection. Core already excludes FilterSet-sourced
 *   clauses, so this set is exactly the foreign ones. Each maps to a chip using
 *   the declaration's `label` (annotation) and `meta.column`; clearing one
 *   publishes a null predicate for the WHOLE clause (per-value narrowing stays a
 *   FilterSet concern).
 */
export function useActiveFilters(): Array<ActiveFilterChip> {
  const topology = useMosaicTopology();
  const filterSet = usePaaFilterSet();
  const filterSetChips = useFilterSetChips(filterSet);
  const foreignClauses = useMosaicActiveClauses();

  return useMemo(() => {
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

    // A foreign clause on a base source (here, `spotlight`) is RELAYED into the
    // derived crossfilter read-contexts (`page`, every `summaryFilterBy:*`),
    // which the topology also observes — so the same clause is reported once per
    // context it reached. The recipe skips those derived read-contexts, so each
    // foreign clause surfaces exactly once on its base source; a `seenSources`
    // guard is belt-and-braces against any residual duplicate.
    const seenSources = new Set<object>();
    for (const active of foreignClauses) {
      if (isDerivedContextRef(active.ref)) {
        continue;
      }
      if (seenSources.has(active.clause.source)) {
        continue;
      }
      seenSources.add(active.clause.source);
      const column = readColumn(active.meta);
      chips.push({
        key: `foreign:${active.ref}`,
        label: active.label ?? column ?? active.entry,
        value: formatForeignValue(active.clause.value),
        target: active.ref,
        operator: undefined,
        foreign: true,
        // Clear the WHOLE clause: publish a null-predicate clause from its own
        // source onto its owning Selection. Per-value narrowing stays a
        // FilterSet concern. (A null-predicate publish clears every resolution
        // type, including `single`, where `Selection.remove(source)` does not.)
        remove: () => {
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
