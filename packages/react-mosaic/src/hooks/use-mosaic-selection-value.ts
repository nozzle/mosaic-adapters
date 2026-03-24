/**
 * Hook to read the current value of a Mosaic Selection.
 * Automatically updates when the selection value changes.
 *
 * Removes the need for repetitive useEffect logic in consumer components.
 */
import { useSyncExternalStore } from 'react';
import type { Selection } from '@uwdata/mosaic-core';

export function useMosaicSelectionValue<T>(selection: Selection): T | null {
  return useSyncExternalStore(
    (notify) => {
      selection.addEventListener('value', notify);
      return () => selection.removeEventListener('value', notify);
    },
    () => selection.value as T | null,
    () => selection.value as T | null,
  );
}
