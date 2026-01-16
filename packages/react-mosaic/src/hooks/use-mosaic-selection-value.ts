/**
 * Hook to read the current value of a Mosaic Selection.
 * Automatically updates when the selection value changes.
 *
 * Removes the need for repetitive useEffect logic in consumer components.
 */
import { useEffect, useState } from 'react';
import type { Selection } from '@uwdata/mosaic-core';

export function useMosaicSelectionValue<T>(selection: Selection): T | null {
  // Initialize with current value
  const [val, setVal] = useState<T | null>(() => selection.value as T);

  useEffect(() => {
    // Handler to update state on selection change
    const handler = () => {
      // Direct access ensures freshness
      setVal(selection.value as T);
    };

    // Subscribe to updates
    selection.addEventListener('value', handler);
    return () => selection.removeEventListener('value', handler);
  }, [selection]);

  return val;
}
