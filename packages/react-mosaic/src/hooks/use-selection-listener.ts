/**
 * Hook to listen to changes on a Mosaic Selection.
 * Equivalent to `selection.addEventListener('value', handler)`.
 */
import { useEffect } from 'react';
import type { Selection } from '@uwdata/mosaic-core';

export function useSelectionListener(
  selection: Selection,
  handler: () => void,
  event: 'value' | 'active' = 'value',
) {
  useEffect(() => {
    selection.addEventListener(event, handler);

    return () => {
      selection.removeEventListener(event, handler);
    };
  }, [selection, handler, event]);
}
