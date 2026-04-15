/**
 * Hook to read the current value of a Mosaic Selection.
 * Automatically updates when the selection value changes.
 *
 * Removes the need for repetitive useEffect logic in consumer components.
 */
import { useSyncExternalStore } from 'react';
import type { Selection } from '@uwdata/mosaic-core';

export interface UseMosaicSelectionValueOptions {
  /**
   * Optional scoped source/client. When provided, the hook reads the
   * source-specific selection value via `selection.valueFor(source)`.
   */
  source?: unknown;
}

function readSelectionValue<T>(
  selection: Selection,
  options?: UseMosaicSelectionValueOptions,
): T | null {
  const rawValue =
    options?.source !== undefined && options.source !== null
      ? (selection.valueFor(options.source) as T | null | undefined)
      : (selection.value as T | null | undefined);

  return rawValue ?? null;
}

export function useMosaicSelectionValue<T>(
  selection: Selection,
  options?: UseMosaicSelectionValueOptions,
): T | null {
  return useSyncExternalStore(
    (notify) => {
      selection.addEventListener('value', notify);
      return () => selection.removeEventListener('value', notify);
    },
    () => readSelectionValue<T>(selection, options),
    () => readSelectionValue<T>(selection, options),
  );
}
