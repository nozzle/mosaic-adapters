import { useSyncExternalStore } from 'react';
import type { Selection } from '@uwdata/mosaic-core';

export interface UseMosaicSelectionValueOptions {
  /**
   * Clause source to scope the read to (`selection.valueFor(source)`).
   * Without it, the hook reads the active (most recently updated) clause's
   * value — fine for single-publisher Selections, ambiguous otherwise.
   */
  source?: unknown;
}

/**
 * Read a Selection's current clause value reactively — the read-back half of
 * clause publishing. A summary widget that publishes its row selection can
 * render its own selected values (in-widget chips) from the same Selection
 * its siblings consume, so external removals (chip bar, global reset) are
 * reflected without extra wiring.
 *
 * Returns `null` when the selection carries no matching clause.
 */
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

function readSelectionValue<T>(
  selection: Selection,
  options?: UseMosaicSelectionValueOptions,
): T | null {
  const raw =
    options?.source !== undefined && options.source !== null
      ? (selection.valueFor(options.source) as T | null | undefined)
      : (selection.value as T | null | undefined);
  return raw ?? null;
}
