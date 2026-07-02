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
  const { filters, selection, columns } = options;

  const bridgeRef = useRef<FilterBridge | null>(null);

  useEffect(() => {
    const bridge = createFilterBridge({ selection });
    bridgeRef.current = bridge;
    return () => {
      bridgeRef.current = null;
      bridge.destroy();
    };
  }, [selection]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (bridge === null) {
      return;
    }
    bridge.setColumns(columns);
    bridge.setFilters(filters);
  });
}
