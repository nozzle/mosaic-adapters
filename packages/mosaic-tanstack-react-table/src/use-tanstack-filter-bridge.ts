import { useEffect, useRef } from 'react';
import { createFilterBridge } from '@nozzleio/mosaic-tanstack-table-core';
import type { FilterSet } from '@nozzleio/mosaic-core';
import type { ColumnFiltersState } from '@tanstack/react-table';
import type {
  FilterBridge,
  FilterBridgeColumns,
} from '@nozzleio/mosaic-tanstack-table-core';

export interface UseTanStackFilterBridgeOptions {
  /** TanStack column-filter state (consumer-owned, controlled). */
  filters: ColumnFiltersState;
  /** FilterSet that receives one spec per actively filtered column. */
  set: FilterSet;
  /**
   * Per-column clause config, keyed by TanStack column id. Compared by
   * value — inline literals are fine.
   */
  columns: FilterBridgeColumns;
  /**
   * Prefix for every managed spec id (`spec.id = `${idPrefix}${columnId}``).
   * Defaults to `''`. Compared by value — a stable literal is fine.
   */
  idPrefix?: string;
  /**
   * Reports the TanStack `columnFilters` state the consumer should adopt after
   * an external spec change (a chip bar's X, a global `set.reset()`, or
   * persisted state hydrated before mount): the bridge inverts the surviving
   * specs back to filter values so the consumer can prune cleared columns or
   * hydrate persisted ones. Held by latest-ref — a new function identity never
   * recreates the bridge.
   */
  onExternalChange?: (filters: ColumnFiltersState) => void;
}

/**
 * Controlled wrapper over the filter-bridge core: translates TanStack
 * `columnFilters` state into {@link FilterSpec}s on a FilterSet.
 *
 * The bridge owns no data client and renders nothing, so its lifecycle is
 * entirely effect-scoped: created post-commit, destroyed (removing every
 * managed spec) on unmount or when `set` changes identity. A new bridge adopts
 * any specs already in the set under its managed ids; the sync effect below
 * runs in the same commit and reconciles the current state. `filters` and
 * `columns` are synced every render; the core value-diffs, so re-renders with
 * equal state publish nothing and cannot echo into a Selection-activation
 * feedback loop.
 */
export function useTanStackFilterBridge(
  options: UseTanStackFilterBridgeOptions,
): void {
  const { filters, set, columns, idPrefix, onExternalChange } = options;

  const bridgeRef = useRef<FilterBridge | null>(null);
  const onExternalChangeRef = useRef(onExternalChange);
  const columnsRef = useRef(columns);
  const hasExternalChange = onExternalChange !== undefined;

  // Latest-refs: the bridge invokes the callback from set-store events (always
  // post-commit), so syncing in an effect is early enough. `columns` rides
  // along (this effect runs before the lifecycle effect below) so a bridge
  // re-creation sees the current config without it joining the lifecycle deps.
  useEffect(() => {
    onExternalChangeRef.current = onExternalChange;
    columnsRef.current = columns;
  });

  useEffect(() => {
    // The initial columns must reach the constructor: hydration adoption
    // scans the set for specs under the managed (column-derived) ids, so a
    // column-less bridge would never adopt persisted state at mount.
    const bridge = createFilterBridge({
      set,
      columns: columnsRef.current,
      idPrefix,
      onExternalChange: hasExternalChange
        ? (nextFilters) => {
            onExternalChangeRef.current?.(nextFilters);
          }
        : undefined,
    });
    bridgeRef.current = bridge;
    return () => {
      bridgeRef.current = null;
      bridge.destroy();
    };
  }, [set, idPrefix, hasExternalChange]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (bridge === null) {
      return;
    }
    bridge.setColumns(columns);
    bridge.setFilters(filters);
  });
}
