import { useEffect, useMemo } from 'react';
import { MosaicFilter } from '@nozzleio/mosaic-tanstack-table-core';
import type {
  FilterMode,
  MosaicFilterOptions,
} from '@nozzleio/mosaic-tanstack-table-core';

export type MosaicTableFilterMode = Exclude<FilterMode, 'CONDITION'>;
export type MosaicTableFilterOptions<TMode extends MosaicTableFilterMode> =
  MosaicFilterOptions<TMode>;

/**
 * React hook to create a stable MosaicFilter instance.
 * Strictly typed with the FilterMode generic to ensure type safety for input values.
 */
export function useMosaicTableFilter<TMode extends MosaicTableFilterMode>(
  options: MosaicTableFilterOptions<TMode>,
) {
  const { selection, column, mode, debounceTime, id, subquery } = options;

  // 1. Instantiate the controller
  // We use the generic TMode to enforce type safety on the class instance
  const filter = useMemo(() => {
    return new MosaicFilter<TMode>({
      selection,
      column,
      mode,
      debounceTime,
      id,
    } as MosaicFilterOptions<TMode>);
  }, [selection, column, mode, debounceTime, id]);

  // 2. Keep the latest subquery factory attached without invalidating the
  // filter instance when consumers pass inline lambdas.
  useEffect(() => {
    if (subquery) {
      filter.updateSubquery(subquery);
    }
  }, [filter, subquery]);

  // 3. Cleanup on unmount or reconfiguration
  useEffect(() => {
    return () => {
      filter.dispose();
    };
  }, [filter]);

  return filter;
}
