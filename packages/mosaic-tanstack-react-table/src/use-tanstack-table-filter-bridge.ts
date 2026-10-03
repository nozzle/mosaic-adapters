import type { FilterSet } from '@nozzleio/mosaic-core';
import { createTanStackTableFilterBridge } from '@nozzleio/mosaic-tanstack-table-core';
import type { FilterBridge, FilterBridgeColumns } from '@nozzleio/mosaic-tanstack-table-core';
import type { ColumnFiltersState } from '@tanstack/react-table';
import { useEffect, useLayoutEffect, useRef } from 'react';

export interface UseTanStackTableFilterBridgeOptions {
  /** TanStack Table column-filter state (consumer-owned, controlled). */
  filters: ColumnFiltersState;
  /**
   * FilterSet that receives one spec per actively filtered column. `undefined`
   * makes the bridge inert — no bridge exists, nothing is published, and
   * `onExternalChange` never fires — so a conditionally enabled bridge needs
   * no wrapper component. Switching from a set to `undefined` tears the
   * bridge down exactly like an unmount (honouring `retainSpecsOnUnmount`).
   */
  set: FilterSet | undefined;
  /**
   * Per-column clause config, keyed by TanStack Table column id. Compared by
   * value — inline literals are fine.
   */
  columns: FilterBridgeColumns;
  /**
   * Prefix for every managed spec id (`spec.id = `${idPrefix}${columnId}``).
   * Defaults to `''`. Compared by value — a stable literal is fine.
   */
  idPrefix?: string;
  /**
   * Reports the TanStack Table `columnFilters` state the consumer should adopt after
   * an external spec change (a chip bar's X, a global `set.reset()`, or
   * persisted state hydrated before mount): the bridge inverts the surviving
   * specs back to filter values so the consumer can prune cleared columns or
   * hydrate persisted ones. Held by latest-ref — a new function identity never
   * recreates the bridge.
   */
  onExternalChange?: (filters: ColumnFiltersState) => void;
  /**
   * Leave the managed specs in the set when the bridge is torn down (unmount,
   * a `set`/`idPrefix` change, or `set` becoming `undefined`) instead of
   * removing them, so the table's filters stay applied while it is gone.
   * Defaults to `false`: teardown removes every spec the bridge wrote.
   *
   * A later bridge re-adopts retained specs only with `onExternalChange`;
   * removing them eventually is the consumer's responsibility. Read at
   * teardown time — changing it never recreates the bridge.
   */
  retainSpecsOnUnmount?: boolean;
}

/**
 * @deprecated Use {@link UseTanStackTableFilterBridgeOptions} instead.
 */
export interface UseTanStackFilterBridgeOptions extends UseTanStackTableFilterBridgeOptions {}

/**
 * Controlled wrapper over the filter-bridge core: translates TanStack Table
 * `columnFilters` state into {@link FilterSpec}s on a FilterSet.
 *
 * The bridge owns no data client and renders nothing, so its lifecycle is
 * entirely effect-scoped: created post-commit (only while `set` is defined),
 * destroyed (removing every managed spec, unless `retainSpecsOnUnmount`) on
 * unmount or when `set` changes identity or becomes `undefined`. A new bridge adopts
 * any specs already in the set under its managed ids; the sync effect below
 * runs in the same commit and reconciles the current state. `filters` and
 * `columns` are synced every render; the core value-diffs, so re-renders with
 * equal state publish nothing and cannot echo into a Selection-activation
 * feedback loop.
 */
export function useTanStackTableFilterBridge(options: UseTanStackTableFilterBridgeOptions): void {
  const { filters, set, columns, idPrefix, onExternalChange, retainSpecsOnUnmount } = options;

  const bridgeRef = useRef<FilterBridge | null>(null);
  const onExternalChangeRef = useRef(onExternalChange);
  const columnsRef = useRef(columns);
  const retainSpecsRef = useRef(retainSpecsOnUnmount);
  const hasExternalChange = onExternalChange !== undefined;

  // Latest-refs: the bridge invokes the callback from set-store events (always
  // post-commit), so syncing in an effect is early enough. `columns` rides
  // along (this effect runs before the lifecycle effect below) so a bridge
  // re-creation sees the current config without it joining the lifecycle deps.
  useEffect(() => {
    onExternalChangeRef.current = onExternalChange;
    columnsRef.current = columns;
  });

  // `retainSpecsOnUnmount` is read by the lifecycle cleanup, which runs in the
  // passive phase *before* this render's passive effects. Syncing in a layout
  // effect (which runs earlier in the same commit) means a render that both
  // flips the flag and tears the bridge down (`set` → `undefined`) honours
  // the new value.
  useLayoutEffect(() => {
    retainSpecsRef.current = retainSpecsOnUnmount;
  });

  useEffect(() => {
    // Inert without a set: no bridge, so the sync effect below is a no-op.
    if (set === undefined) {
      return;
    }
    // The initial columns must reach the constructor: hydration adoption
    // scans the set for specs under the managed (column-derived) ids, so a
    // column-less bridge would never adopt persisted state at mount.
    const bridge = createTanStackTableFilterBridge({
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
      bridge.destroy({ retainSpecs: retainSpecsRef.current === true });
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

/**
 * @deprecated Use {@link useTanStackTableFilterBridge} instead.
 */
export const useTanStackFilterBridge = useTanStackTableFilterBridge;
