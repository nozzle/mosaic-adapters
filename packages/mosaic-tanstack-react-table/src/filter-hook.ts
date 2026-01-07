import { useEffect, useMemo } from 'react';
import { MosaicFilter } from '@nozzleio/mosaic-tanstack-table-core';
import type {
  FilterMode,
  MosaicFilterOptions,
} from '@nozzleio/mosaic-tanstack-table-core';

/**
 * React hook to create a stable MosaicFilter instance.
 * Strictly typed with the FilterMode generic to ensure type safety for input values.
 */
export function useMosaicTableFilter<TMode extends FilterMode>(
  options: MosaicFilterOptions<TMode>,
) {
  const { selection, column, mode, debounceTime, id } = options;

  // 1. Instantiate the controller
  // We use the generic TMode to enforce type safety on the class instance
  const filter = useMemo(() => {
    return new MosaicFilter<TMode>({
      selection,
      column,
      mode,
      debounceTime,
      id,
    });
  }, [selection, column, mode, debounceTime, id]);

  // 2. Cleanup on unmount or reconfiguration
  useEffect(() => {
    return () => {
      filter.dispose();
    };
  }, [filter]);

  return filter;
}
