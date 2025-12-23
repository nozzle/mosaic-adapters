import { useEffect, useMemo } from 'react';
import { MosaicFilter } from '@nozzleio/mosaic-tanstack-table-core';
import type { MosaicFilterOptions } from '@nozzleio/mosaic-tanstack-table-core';

export function useMosaicFilter(options: MosaicFilterOptions) {
  const { selection, column, mode, debounceTime, id } = options;

  // 1. Instantiate the controller
  // We destructure options to ensure the filter is recreated only when specific configuration properties change,
  // rather than on every render if the options object reference changes.
  const filter = useMemo(() => {
    return new MosaicFilter({ selection, column, mode, debounceTime, id });
  }, [selection, column, mode, debounceTime, id]);

  // 2. Cleanup on unmount or reconfiguration
  useEffect(() => {
    return () => {
      filter.dispose();
    };
  }, [filter]);

  return filter;
}
