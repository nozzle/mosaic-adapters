import * as React from 'react';
import {
  useMosaicHistogram,
  useMosaicTableFilter,
} from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection } from '@uwdata/mosaic-core';
import { cn } from '@/lib/utils';

interface HistogramProps {
  table: string;
  column: string;
  step: number;
  /** Selection used to output the range filter */
  selection: Selection;
  /** Selection used to input global context */
  filterBy: Selection;
  height?: number;
}

/**
 * A visual Histogram component that acts as a Range Filter.
 * Displays binned data and allows interaction to filter the underlying selection.
 */
export function HistogramFilter({
  table,
  column,
  step,
  selection,
  filterBy,
  height = 80,
}: HistogramProps) {
  const bins = useMosaicHistogram({ table, column, step, filterBy });

  const filter = useMosaicTableFilter({
    selection,
    column,
    mode: 'RANGE',
  });

  const maxCount = Math.max(...bins.map((b) => b.count), 0);

  // Determine active range from filter selection value (if present) for styling
  // We explicitly extract the value to avoid "Unnecessary conditional" lint errors
  const selectionValue = selection.value as [number, number] | null | undefined;
  const activeMin = selectionValue?.[0] ?? null;
  const activeMax = selectionValue?.[1] ?? null;

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        Distribution ({column})
      </div>

      <div
        className="flex items-end gap-[1px] w-full border-b border-slate-200"
        style={{ height }}
      >
        {bins.length === 0 ? (
          <div className="w-full text-center text-xs text-slate-400 italic mb-4">
            No data
          </div>
        ) : (
          bins.map((item) => {
            const heightPct = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
            const binStart = item.bin;
            const binEnd = item.bin + step;

            // Highlight bar if it falls within the active filter range
            let isActive = false;
            if (activeMin !== null && activeMax !== null) {
              isActive = binStart >= activeMin && binEnd <= activeMax;
            }

            return (
              <div
                key={item.bin}
                className={cn(
                  'flex-1 bg-slate-200 hover:bg-slate-400 transition-colors relative group cursor-pointer rounded-t-sm min-w-[2px]',
                  isActive && 'bg-slate-600 hover:bg-slate-700',
                )}
                style={{ height: `${Math.max(heightPct, 5)}%` }} // Min height for visibility
                onClick={() => {
                  // Click interaction: Toggle specific bin range
                  filter.setValue([binStart, binEnd]);
                }}
                title={`${binStart} - ${binEnd}: ${item.count}`}
              />
            );
          })
        )}
      </div>

      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
        <span>{bins[0]?.bin ?? 0}</span>
        <span>{(bins[bins.length - 1]?.bin ?? 0) + step}</span>
      </div>
    </div>
  );
}
