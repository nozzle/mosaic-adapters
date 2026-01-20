import { FilterX, X } from 'lucide-react';
import {
  useActiveFilters,
  useFilterRegistry,
  useSelectionRegistry,
} from '@nozzleio/react-mosaic';
import { Button } from '@/components/ui/button';

/**
 * UI Component that displays currently active filters as removable chips.
 * Uses the Mosaic Filter Registry to get state and perform removals.
 */
export function ActiveFilterBar() {
  const filters = useActiveFilters();
  const registry = useFilterRegistry();
  const { resetAll } = useSelectionRegistry();

  if (filters.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 p-4 bg-white border-b border-slate-200 items-center animate-in fade-in slide-in-from-top-1">
      <div className="flex items-center text-xs font-bold text-slate-500 uppercase mr-2 gap-1">
        <FilterX className="size-3" />
        Active:
      </div>

      {filters.map((filter) => (
        <div
          key={filter.id}
          className="flex items-center gap-1 pl-2 pr-1 py-1 rounded-full bg-blue-50 border border-blue-200 text-xs text-blue-800 shadow-sm transition-all hover:bg-blue-100"
        >
          <span className="font-semibold text-blue-900">{filter.label}:</span>
          <span
            className="max-w-[150px] truncate"
            title={filter.formattedValue}
          >
            {filter.formattedValue}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 ml-1 hover:bg-blue-200 rounded-full text-blue-700"
            onClick={() => registry.removeFilter(filter)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="sm"
        className="text-xs text-slate-500 h-6 hover:text-red-600"
        onClick={resetAll}
      >
        Clear All
      </Button>
    </div>
  );
}
