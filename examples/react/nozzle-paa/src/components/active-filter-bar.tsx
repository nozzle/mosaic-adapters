import { useFilterChips } from '@nozzleio/react-mosaic';
import { filterRegistry } from '../page-context';

/**
 * Removable chips for every active filter on the page, straight from the
 * filter registry. One X removes one filter (narrowing exploded row
 * selections); "Clear All" resets every registered Selection.
 */
export function ActiveFilterBar() {
  const chips = useFilterChips(filterRegistry);

  if (chips.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="active-filter-bar"
      className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white p-4"
    >
      <div className="mr-2 text-xs font-bold text-slate-500 uppercase">
        Active:
      </div>

      {chips.map((chip) => (
        <div
          key={chip.id}
          className="flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-1 pr-1 pl-2 text-xs text-blue-800 shadow-sm transition-all hover:bg-blue-100"
        >
          <span className="font-semibold text-blue-900">{chip.label}:</span>
          <span className="max-w-[150px] truncate" title={chip.formattedValue}>
            {chip.formattedValue}
          </span>
          <button
            type="button"
            className="ml-1 h-4 w-4 rounded-full text-blue-700 hover:bg-blue-200"
            aria-label={`Remove filter ${chip.label}: ${chip.formattedValue}`}
            onClick={() => filterRegistry.removeChip(chip)}
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
        onClick={() => filterRegistry.resetAll()}
      >
        Clear All
      </button>
    </div>
  );
}
