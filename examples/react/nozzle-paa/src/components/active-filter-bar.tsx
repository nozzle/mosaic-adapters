import { useMosaicTopology } from '@nozzleio/react-mosaic';
import { useActiveFilters } from '../topology';
import type { ActiveFilterChip } from '../topology';

/**
 * Removable chips for every active filter on the page. Chips come from the
 * app-side {@link useActiveFilters} recipe — the union of the page FilterSet's
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
