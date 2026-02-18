/**
 * @file useServerGroupedTable — thin React wrapper around MosaicGroupedTable.
 *
 * Follows the established `MosaicDataTable` (heavy core) + `useMosaicReactTable`
 * (thin hook) pattern. All logic lives in the framework-agnostic core class;
 * this hook wires lifecycle and exposes reactive state via `useStore`.
 */
import * as React from 'react';
import { useOptionalCoordinator } from '@nozzleio/react-mosaic';
import { useStore } from '@tanstack/react-store';
import { MosaicGroupedTable } from '@nozzleio/mosaic-tanstack-table-core';
import type {
  GroupLevel,
  GroupMetric,
  GroupRow,
  LeafColumn,
  LeafRow,
  MosaicGroupedTableOptions,
  ServerGroupedRow,
} from '@nozzleio/mosaic-tanstack-table-core';
import type { ExpandedState, Row } from '@tanstack/react-table';
import type { Selection } from '@uwdata/mosaic-core';
import type { FilterExpr } from '@uwdata/mosaic-sql';

// Re-export types for convenience
export type {
  GroupLevel,
  GroupMetric,
  GroupRow,
  LeafRow,
  ServerGroupedRow,
  LeafColumn,
};

// ---------------------------------------------------------------------------
// Options (React-facing, superset of core options)
// ---------------------------------------------------------------------------

export interface UseServerGroupedTableOptions {
  /** Table (or view) name to query. */
  table: string;
  /** Hierarchy of columns to group by, in order. */
  groupBy: Array<GroupLevel>;
  /** Aggregation metrics to compute at each level. */
  metrics: Array<GroupMetric>;
  /** Mosaic Selection that provides cross-filter predicates. */
  filterBy: Selection;
  /** Optional row selection integration for cross-filtering output. */
  rowSelection?: { selection: Selection };
  /** Additional static WHERE clauses (e.g., NULL exclusion). */
  additionalWhere?: FilterExpr | null;
  /** Maximum rows per level. Defaults to 200. */
  pageSize?: number;
  /** Columns to fetch for raw leaf rows. */
  leafColumns?: Array<LeafColumn>;
  /** Maximum leaf rows to fetch per parent. Defaults to 50. */
  leafPageSize?: number;
  /** When true, leaf row queries use SELECT * instead of only named leafColumns. */
  leafSelectAll?: boolean;
  /** Whether the hook is active. Defaults to true. */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Return Type
// ---------------------------------------------------------------------------

export interface ServerGroupedTableResult {
  /** Tree-structured data for TanStack Table. */
  data: Array<ServerGroupedRow>;
  /** Current expanded state keyed by row ID. */
  expanded: ExpandedState;
  /** Toggle a row's expanded state. Fires child query if needed. */
  toggleExpand: (row: Row<ServerGroupedRow>) => void;
  /** Whether the root query is loading. */
  isRootLoading: boolean;
  /** Total root-level group count. */
  totalRootRows: number;
  /** IDs of groups currently loading children. */
  loadingGroupIds: Array<string>;
  /** Clear the current row selection. */
  clearSelection: () => void;
  /** Leaf columns configuration (if any). */
  leafColumns?: Array<LeafColumn>;
  /** Table name for detail panel queries. */
  tableName: string;
  /** Additional WHERE clause for detail panel queries. */
  additionalWhere?: FilterExpr | null;
  /** Filter selection for detail panel queries. */
  filterBy: Selection;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useServerGroupedTable(
  options: UseServerGroupedTableOptions,
): ServerGroupedTableResult {
  const {
    table,
    groupBy,
    metrics,
    filterBy,
    rowSelection,
    additionalWhere,
    pageSize,
    leafColumns,
    leafPageSize,
    leafSelectAll,
    enabled = true,
  } = options;

  const coordinator = useOptionalCoordinator();

  // Build core options (exclude React-only `enabled`)
  const coreOptions: MosaicGroupedTableOptions = React.useMemo(
    () => ({
      table,
      groupBy,
      metrics,
      filterBy,
      rowSelection,
      additionalWhere,
      pageSize,
      leafColumns,
      leafPageSize,
      leafSelectAll,
    }),

    [
      table,
      groupBy,
      metrics,
      filterBy,
      rowSelection,
      additionalWhere,
      pageSize,
      leafColumns,
      leafPageSize,
      leafSelectAll,
    ],
  );

  // 1. Create core client once
  const [client] = React.useState(() => new MosaicGroupedTable(coreOptions));

  // 2. Set coordinator
  React.useEffect(() => {
    client.setCoordinator(coordinator);
  }, [client, coordinator]);

  // 3. Update options when they change
  React.useEffect(() => {
    client.updateOptions(coreOptions);
  }, [client, coreOptions]);

  // 4. Connect/disconnect based on enabled + coordinator
  React.useEffect(() => {
    if (!coordinator || !enabled) {
      client.disconnect();
      return;
    }
    return client.connect();
  }, [client, coordinator, enabled]);

  // 5. Subscribe to store
  const state = useStore(client.store);

  // 6. Wrap toggleExpand to accept Row<ServerGroupedRow>
  const toggleExpand = React.useCallback(
    (row: Row<ServerGroupedRow>) => {
      client.toggleExpand(row.id);
    },
    [client],
  );

  const clearSelection = React.useCallback(() => {
    client.clearSelection();
  }, [client]);

  return {
    data: state.treeData,
    expanded: state.expanded,
    toggleExpand,
    isRootLoading: state.isRootLoading,
    totalRootRows: state.totalRootRows,
    loadingGroupIds: state.loadingGroupIds,
    clearSelection,
    leafColumns,
    tableName: table,
    additionalWhere,
    filterBy,
  };
}
