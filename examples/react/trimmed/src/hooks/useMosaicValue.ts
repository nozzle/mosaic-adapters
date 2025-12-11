// A hook to fetch single scalar values from Mosaic queries, primarily used for KPI cards.

import { useState, useEffect } from 'react';
import * as vg from '@uwdata/vgplot';
import { isArrowTable, type Selection } from '@uwdata/mosaic-core';

/**
 * HOOK: useMosaicValue
 * Connects a specific SQL Aggregation query to a React state value.
 * Used for KPI Cards and Single-Value metrics.
 *
 * @param queryFactory - A function that accepts a filter predicate and returns a query object.
 * @param selection - The Mosaic Selection to listen to for updates.
 */
export function useMosaicValue(
  queryFactory: (filter: any) => any,
  selection: Selection,
) {
  const [value, setValue] = useState<number | string>('-');

  useEffect(() => {
    const update = async () => {
      // 1. Resolve the current filter state from the Selection
      const predicate = selection.predicate(null);

      // 2. Build the query using the factory
      const query = queryFactory(predicate);

      // 3. Execute via Coordinator (WASM/Socket)
      // We convert to string to ensure the connector receives a raw SQL string
      const result = await vg.coordinator().query(query.toString());

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
    update();

    // 5. Subscribe to Selection changes to trigger re-fetches
    selection.addEventListener('value', update);
    return () => selection.removeEventListener('value', update);
  }, [queryFactory, selection]);

  return value;
}
