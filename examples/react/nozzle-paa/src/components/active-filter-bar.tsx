import { useFilterSetChips } from '@nozzleio/react-mosaic';
import { filterSet } from '../page-context';
import type { FilterSetChip } from '@nozzleio/react-mosaic';

/**
 * Removable chips for every active filter on the page, straight from the page
 * {@link filterSet}. One X removes/narrows one filter (exploded row selections
 * narrow); "Clear All" resets the whole set.
 *
 * Chips are ordered by spec-id prefix to preserve the legacy grouping:
 * global controls (1) → summary selections + metric thresholds (2) → detail
 * column filters (3).
 */
function chipRank(chip: FilterSetChip): number {
  if (chip.id.startsWith('select:') || chip.id.startsWith('metric:')) {
    return 2;
  }
  if (chip.id.startsWith('detail:')) {
    return 3;
  }
  return 1;
}

/**
 * Maps a chip's resolved routing `target` to a short placement badge:
 * `where` → "WHERE" (row-level predicate), anything `having:`/`members:` →
 * "HAVING" (aggregate threshold + its membership overlay).
 */
function placementBadge(target: string): string {
  if (target.startsWith('having:') || target.startsWith('members:')) {
    return 'HAVING';
  }
  return 'WHERE';
}

export function ActiveFilterBar() {
  const chips = useFilterSetChips(filterSet);

  if (chips.length === 0) {
    return null;
  }

  // Stable sort by group rank; ties keep set (insertion) order.
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
          className="flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-1 pr-1 pl-2 text-xs text-blue-800 shadow-sm transition-all hover:bg-blue-100"
        >
          <span
            data-testid="chip-target"
            className="rounded-sm bg-orange-100 px-1 text-[9px] font-bold tracking-wider text-orange-600"
          >
            {placementBadge(chip.target)}
          </span>
          {chip.operator !== undefined ? (
            <span
              data-testid="chip-operator"
              className="rounded-sm bg-slate-100 px-1 text-[9px] font-bold tracking-wider text-slate-500"
            >
              {chip.operator}
            </span>
          ) : null}
          <span className="font-semibold text-blue-900">{chip.label}:</span>
          <span className="max-w-[150px] truncate" title={chip.formattedValue}>
            {chip.formattedValue}
          </span>
          <button
            type="button"
            className="ml-1 h-4 w-4 rounded-full text-blue-700 hover:bg-blue-200"
            aria-label={`Remove filter ${chip.label}: ${chip.formattedValue}`}
            onClick={() => filterSet.removeChip(chip)}
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
        onClick={() => filterSet.reset()}
      >
        Clear All
      </button>
    </div>
  );
}
