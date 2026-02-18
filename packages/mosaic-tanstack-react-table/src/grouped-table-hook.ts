/**
 * @file useServerGroupedTable — thin React wrapper around MosaicGroupedTable.
 *
 * Returns `{ tableOptions, client }` — the consumer passes `tableOptions`
 * directly to `useReactTable()`, matching the `useMosaicReactTable` pattern.
 * All logic lives in the framework-agnostic core class; this hook wires
 * lifecycle and exposes reactive state via `useStore`.
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
import type { ColumnDef, TableOptions } from '@tanstack/react-table';
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
  /** TanStack column definitions for the grouped table. */
  columns: Array<ColumnDef<ServerGroupedRow, any>>;
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
  /** TanStack TableOptions — pass directly to useReactTable(). */
  tableOptions: TableOptions<ServerGroupedRow>;
  /** The core client for programmatic access. */
  client: MosaicGroupedTable;
  /** Whether the root query is loading. */
  isRootLoading: boolean;
  /** Total root-level group count. */
  totalRootRows: number;
  /** IDs of groups currently loading children. */
  loadingGroupIds: Array<string>;
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
    columns,
    rowSelection,
    additionalWhere,
    pageSize,
    leafColumns,
    leafPageSize,
    leafSelectAll,
    enabled = true,
  } = options;

  const coordinator = useOptionalCoordinator();

  // Build core options (exclude React-only `enabled` and `columns`)
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

  // 2. Set coordinator (same pattern as useMosaicReactTable)
  React.useEffect(() => {
    if (!enabled || !coordinator) {
      return;
    }
    client.setCoordinator(coordinator);
  }, [client, coordinator, enabled]);

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

  // 6. Build tableOptions via core class
  const tableOptions = React.useMemo(
    () => client.getTableOptions(state, columns),
    [client, state, columns],
  );

  return {
    tableOptions,
    client,
    isRootLoading: state.isRootLoading,
    totalRootRows: state.totalRootRows,
    loadingGroupIds: state.loadingGroupIds,
  };
}
