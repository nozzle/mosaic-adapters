import { useEffect, useRef } from 'react';
import { createFilterBridge } from '@nozzleio/mosaic-tanstack-table-core';
import type { Selection } from '@uwdata/mosaic-core';
import type { ColumnFiltersState } from '@tanstack/table-core';
import type {
  FilterBridge,
  FilterBridgeColumns,
} from '@nozzleio/mosaic-tanstack-table-core';

export interface UseTanStackFilterBridgeOptions {
  /** TanStack column-filter state (consumer-owned, controlled). */
  filters: ColumnFiltersState;
  /** Selection that receives one clause per actively filtered column. */
  selection: Selection;
  /**
   * Per-column clause config, keyed by TanStack column id. Compared by
   * value — inline literals are fine.
   */
  columns: FilterBridgeColumns;
  /**
   * Makes external clause removals (chip bar, global reset) win over
   * TanStack state: the bridge reports the cleared column ids so the
   * consumer can prune its `columnFilters` state (and with it, the filter
   * inputs). Without it, the next state sync republishes the clause. Held
   * by latest-ref — a new function identity never recreates the bridge.
   */
  onExternalClear?: (columnIds: Array<string>) => void;
}

/**
 * Controlled wrapper over the filter-bridge core: publishes TanStack
 * `columnFilters` state as clauses on a Selection.
 *
 * The bridge owns no data client and renders nothing, so its lifecycle is
 * entirely effect-scoped: created post-commit, destroyed (removing every
 * published clause) on unmount or when `selection` changes identity. A new
 * bridge starts empty; the sync effect below runs in the same commit and
 * publishes the current state. `filters` and `columns` are synced every
 * render; the core value-diffs, so re-renders with equal state publish
 * nothing and cannot echo into a Selection-activation feedback loop.
 */
export function useTanStackFilterBridge(
  options: UseTanStackFilterBridgeOptions,
): void {
  const { filters, selection, columns, onExternalClear } = options;

  const bridgeRef = useRef<FilterBridge | null>(null);
  const onExternalClearRef = useRef(onExternalClear);
  const hasExternalClear = onExternalClear !== undefined;

  // Latest-ref: the bridge invokes the callback from Selection value events
  // (always post-commit), so syncing it in an effect is early enough.
  useEffect(() => {
    onExternalClearRef.current = onExternalClear;
  });

  useEffect(() => {
    const bridge = createFilterBridge({
      selection,
      onExternalClear: hasExternalClear
        ? (columnIds) => {
            onExternalClearRef.current?.(columnIds);
          }
        : undefined,
    });
    bridgeRef.current = bridge;
    return () => {
      bridgeRef.current = null;
      bridge.destroy();
    };
  }, [selection, hasExternalClear]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (bridge === null) {
      return;
    }
    bridge.setColumns(columns);
    bridge.setFilters(filters);
  });
}
