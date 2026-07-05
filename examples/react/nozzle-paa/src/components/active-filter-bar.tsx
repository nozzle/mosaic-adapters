import { useMemo } from 'react';
import {
  useFilterSetChips,
  useMosaicActiveClauses,
  useMosaicTopology,
} from '@nozzleio/react-mosaic';
import { PAGE_ENTRY } from '../page-context';
import { usePageFilterSet } from '../topology';
import type { FilterSetChip } from '@nozzleio/react-mosaic';

/**
 * Removable chips for every active filter on the page. Chips come from the
 * {@link useActiveFilters} recipe below — the union of the page FilterSet's
 * spec-derived chips and the topology's genuinely FOREIGN clauses (the
 * "Domain spotlight" single Selection, published direct-to-Selection). One X
 * removes/narrows one filter (a FilterSet chip narrows; a foreign chip clears
 * the whole clause); "Clear All" is `topology.reset()` — clearing both the
 * FilterSet specs AND the non-FilterSet selections in one call.
 *
 * Chips are ordered so foreign clauses trail the FilterSet chips, and within the
 * FilterSet the legacy grouping holds: global controls → summary selections +
 * metric thresholds → detail column filters.
 */

/**
 * A unified active-filter chip — the shape this bar renders. Both
 * FilterSet-derived chips (spec/kind clauses) and foreign clauses (Selections
 * the FilterSet does not own) normalize to this. Deliberately app-local: the
 * chip model, its grouping, and this union are exactly where apps differ, so
 * they live here, next to the only bar that renders them, not in any package.
 */
interface ActiveFilterChip {
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
 * True when a topology ref names one of the derived crossfilter read-contexts
 * (`page`, `summaryFilterBy:<card>`). These external composites only RELAY the
 * base selections' clauses, so the topology's active-clause store reports a
 * foreign clause once per context it reached — the {@link useActiveFilters}
 * recipe skips them so a foreign clause surfaces once, on its base source.
 */
function isDerivedContextRef(ref: string): boolean {
  const entry = ref.includes('.') ? ref.slice(0, ref.indexOf('.')) : ref;
  return entry === PAGE_ENTRY || entry.startsWith('summaryFilterBy:');
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
function useActiveFilters(): Array<ActiveFilterChip> {
  const topology = useMosaicTopology();
  const filterSet = usePageFilterSet();
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

function chipRank(chip: ActiveFilterChip): number {
  if (chip.foreign) {
    return 4;
  }
  if (chip.key.startsWith('fs:select:') || chip.key.startsWith('fs:metric:')) {
    return 2;
  }
  if (chip.key.startsWith('fs:detail:')) {
    return 3;
  }
  return 1;
}

/**
 * Maps a chip's routing `target` to a short placement badge: any `having:` /
 * `members:` target → "HAVING" (aggregate threshold + its membership overlay);
 * a foreign clause → "SPOTLIGHT"; anything else → "WHERE" (row-level predicate).
 */
function placementBadge(chip: ActiveFilterChip): string {
  if (chip.foreign) {
    return 'SPOTLIGHT';
  }
  if (chip.target.startsWith('having:') || chip.target.startsWith('members:')) {
    return 'HAVING';
  }
  return 'WHERE';
}

export function ActiveFilterBar() {
  const topology = useMosaicTopology();
  const chips = useActiveFilters();

  if (chips.length === 0) {
    return null;
  }

  // Stable sort by group rank; ties keep insertion (source) order.
  const ordered = chips
    .map((chip, index) => ({ chip, index }))
    .sort((a, b) => chipRank(a.chip) - chipRank(b.chip) || a.index - b.index)
    .map((entry) => entry.chip);

  return (
    <div
      data-testid="active-filter-bar"
      className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white p-4"
    >
      <div className="mr-2 text-xs font-bold text-slate-500 uppercase">
        Active:
      </div>

      {ordered.map((chip) => (
        <div
          key={chip.key}
          data-testid={chip.foreign ? 'foreign-chip' : undefined}
          className={`flex items-center gap-1 rounded-full border py-1 pr-1 pl-2 text-xs shadow-sm transition-all ${
            chip.foreign
              ? 'border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100'
              : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
          }`}
        >
          <span
            data-testid="chip-target"
            className="rounded-sm bg-orange-100 px-1 text-[9px] font-bold tracking-wider text-orange-600"
          >
            {placementBadge(chip)}
          </span>
          {chip.operator !== undefined ? (
            <span
              data-testid="chip-operator"
              className="rounded-sm bg-slate-100 px-1 text-[9px] font-bold tracking-wider text-slate-500"
            >
              {chip.operator}
            </span>
          ) : null}
          <span
            className={`font-semibold ${chip.foreign ? 'text-purple-900' : 'text-blue-900'}`}
          >
            {chip.label}:
          </span>
          <span className="max-w-[150px] truncate" title={chip.value}>
            {chip.value}
          </span>
          <button
            type="button"
            className={`ml-1 h-4 w-4 rounded-full ${
              chip.foreign
                ? 'text-purple-700 hover:bg-purple-200'
                : 'text-blue-700 hover:bg-blue-200'
            }`}
            aria-label={`Remove filter ${chip.label}: ${chip.value}`}
            onClick={chip.remove}
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex-1" />

      <button
        type="button"
        data-testid="clear-all-filters"
        className="h-6 rounded px-2 text-xs text-slate-500 hover:text-red-600"
        onClick={() => topology.reset()}
      >
        Clear All
      </button>
    </div>
  );
}
