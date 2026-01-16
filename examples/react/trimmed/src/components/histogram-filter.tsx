import * as React from 'react';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  useMosaicHistogram,
  useMosaicTableFilter,
} from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection } from '@uwdata/mosaic-core';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

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
 * Supports Click-to-Filter and Click-to-Clear (Toggle).
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

  // Reactive State for Selection
  // We must listen to the selection to know when to show the active state/clear button,
  // because cross-filtering often excludes "self", so the data (bins) won't update to trigger a re-render.
  const [currentValue, setCurrentValue] = useState(selection.value);

  useEffect(() => {
    const onValueChange = () => {
      setCurrentValue(selection.value);
    };
    selection.addEventListener('value', onValueChange);
    return () => selection.removeEventListener('value', onValueChange);
  }, [selection]);

  const maxCount = Math.max(...bins.map((b) => b.count), 0);

  // Determine active range from reactive state
  const selectionValue = currentValue as [number, number] | null | undefined;
  const activeMin = selectionValue?.[0] ?? null;
  const activeMax = selectionValue?.[1] ?? null;

  const hasActiveSelection = activeMin !== null && activeMax !== null;

  const handleBinClick = (binStart: number, binEnd: number) => {
    // Toggle Logic: If clicking the exact same range, clear it.
    // We use a small epsilon for float comparison safety
    const isSameMin =
      activeMin !== null && Math.abs(activeMin - binStart) < 0.0001;
    const isSameMax =
      activeMax !== null && Math.abs(activeMax - binEnd) < 0.0001;

    if (isSameMin && isSameMax) {
      filter.setValue(null);
    } else {
      filter.setValue([binStart, binEnd]);
    }
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex justify-between items-end">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          {column}
        </div>
        {hasActiveSelection && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => filter.setValue(null)}
            className="h-5 px-1 text-[10px] text-slate-400 hover:text-red-500 gap-1"
          >
            <X className="size-3" />
            Clear
          </Button>
        )}
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
            // Round to avoid floating point precision issues
            const binEnd = Math.round((item.bin + step) * 100) / 100;

            // Highlight bar if it falls within the active filter range
            let isActive = false;
            if (activeMin !== null && activeMax !== null) {
              const center = binStart + step / 2;
              isActive = center >= activeMin && center <= activeMax;
            }

            return (
              <div
                key={item.bin}
                className={cn(
                  'flex-1 transition-all relative group cursor-pointer rounded-t-sm min-w-[2px]',
                  // Default State
                  'bg-slate-200 hover:bg-slate-400',
                  // Active State
                  isActive && 'bg-blue-600 hover:bg-blue-700',
                )}
                style={{ height: `${Math.max(heightPct, 5)}%` }}
                onClick={() => handleBinClick(binStart, binEnd)}
                title={`${binStart} - ${binEnd}: ${item.count}`}
              >
                {/* Optional: Tooltip content could go here if using a Tooltip component */}
              </div>
            );
          })
        )}
      </div>

      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
        {bins.length > 0 && (
          <>
            <span>{bins[0]?.bin ?? 0}</span>
            <span>
              {Math.round(((bins[bins.length - 1]?.bin ?? 0) + step) * 100) /
                100}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
