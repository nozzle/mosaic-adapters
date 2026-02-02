// A hook to fetch single scalar values from Mosaic queries, primarily used for KPI cards.

import { useEffect, useState } from 'react';
import { isArrowTable } from '@uwdata/mosaic-core';
import { useCoordinator } from '@nozzleio/react-mosaic';
import type { Selection } from '@uwdata/mosaic-core';

export interface UseMosaicValueOptions {
  /**
   * If false, the query will not be executed.
   * Useful for dependent queries or waiting for data initialization.
   * @default true
   */
  enabled?: boolean;
}

/**
 * HOOK: useMosaicValue
 * Connects a specific SQL Aggregation query to a React state value.
 * Used for KPI Cards and Single-Value metrics.
 *
 * @param queryFactory - A function that accepts a filter predicate and returns a query object.
 * @param selection - The Mosaic Selection to listen to for updates.
 * @param options - Configuration options.
 */
export function useMosaicValue(
  queryFactory: (filter: any) => any,
  selection: Selection,
  options: UseMosaicValueOptions = {},
) {
  const [value, setValue] = useState<number | string>('-');
  const coordinator = useCoordinator();
  const { enabled = true } = options;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const setup = async () => {
      // 1. Resolve the current filter state from the Selection
      const predicate = selection.predicate(null);

      // 2. Build the query using the factory
      const query = queryFactory(predicate);

      // 3. Execute via Coordinator
      // We convert to string to ensure the connector receives a raw SQL string
      const result = await coordinator.query(query.toString());

      // 4. Parse Arrow Result
      if (isArrowTable(result) && result.numRows > 0) {
        // We assume the query returns a column specifically named 'value'
        const row = result.get(0);
        setValue(row.value ?? 0);
      } else {
        setValue(0);
      }
    };

    // Initial fetch
    setup();

    // 5. Subscribe to Selection changes to trigger re-fetches
    selection.addEventListener('value', setup);
    return () => selection.removeEventListener('value', setup);
  }, [queryFactory, selection, coordinator, enabled]);

  return value;
}
