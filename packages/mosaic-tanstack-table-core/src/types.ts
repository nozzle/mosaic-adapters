/**
 * Type definitions for the Mosaic TanStack Table Core adapter.
 * Defines configuration options, store structures, and metadata extensions.
 */

import type { Table as ArrowTable } from 'apache-arrow';
import type { Coordinator, Param, Selection } from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  ColumnDef,
  RowData,
  TableOptions,
  TableState,
} from '@tanstack/table-core';

export type MosaicDataTableSqlFilterType =
  | 'EQUALS'
  | 'LIKE'
  | 'PARTIAL_LIKE'
  | 'ILIKE'
  | 'PARTIAL_ILIKE'
  | 'RANGE';

export type FacetSortMode = 'alpha' | 'count';

export type ColumnType = 'scalar' | 'array';

/**
 * Represents the identity source for a selection update.
 */
export type SelectionSource = object;

/**
 * Interface describing the common API surface for Mosaic Clients
 * managed within this library.
 */
export interface IMosaicClient {
  readonly isConnected: boolean;
  connect: () => () => void;
  disconnect: () => void;
  setCoordinator: (coordinator: Coordinator) => void;
  __onConnect?: () => void;
  __onDisconnect?: () => void;
}

/**
 * Internal hooks used by the lifecycle manager.
 */
export interface IMosaicLifecycleHooks {
  __onConnect?: () => void;
  __onDisconnect?: () => void;
}

export type MosaicDataTableColumnDefMetaOptions = {
  mosaicDataTable?: {
    sqlColumn?: string;
    sqlFilterType?: MosaicDataTableSqlFilterType;
    facetSortMode?: FacetSortMode;
    facet?: 'unique' | 'minmax';
  };
};

export type SubsetTableOptions<TData extends RowData> = Omit<
  TableOptions<TData>,
  | 'data'
  | 'columns'
  | 'state'
  | 'onStateChange'
  | 'manualPagination'
  | 'manualSorting'
  | 'rowCount'
  | 'getCoreRowModel'
>;

export type MosaicTableSource =
  | string
  | Param<string>
  | ((filter?: FilterExpr | null) => SelectQuery);

export interface MosaicDataTableOptions<
  TData extends RowData,
  TValue = unknown,
> {
  table: MosaicTableSource;
  coordinator?: Coordinator;
  filterBy?: Selection | undefined;
  highlightBy?: Selection | undefined;
  manualHighlight?: boolean;
  rowSelection?: {
    selection: Selection;
    column: string;
    columnType?: ColumnType;
  };
  tableFilterSelection?: Selection | undefined;
  columns?: Array<ColumnDef<TData, TValue>>;
  tableOptions?: Partial<SubsetTableOptions<TData>>;
  /**
   * The column name to use for the total rows count returned from the query.
   * @default '__total_rows'
   */
  totalRowsColumnName?: string;
  /**
   * Strategy for calculating total row count.
   * - 'split': (Default) Separate async query. Best for massive datasets (100M+).
   * - 'window': Uses COUNT(*) OVER() in the main query. Best for interactive dashboards (Atomic updates).
   */
  totalRowsMode?: 'split' | 'window';
  onTableStateChange?: 'requestQuery' | 'requestUpdate';
  __debugName?: string;
}

export type MosaicDataTableStore<TData extends RowData, TValue = unknown> = {
  columnDefs: Array<ColumnDef<TData, TValue>>;
  tableState: TableState;
  /**
   * The raw Arrow Table result.
   * We store this to support lazy access patterns.
   */
  arrowResult: ArrowTable | null;
  /**
   * The rows array used by TanStack Table.
   * In optimized mode, this contains lightweight objects (e.g. { _index: i })
   * that reference the arrowResult.
   */
  rows: Array<TData>;
  totalRows: number | undefined;
  tableOptions: SubsetTableOptions<TData>;
  _facetsUpdateCount: number;
};

export type FacetClientConfig<TResult extends Array<any>> = {
  filterBy?: Selection;
  coordinator?: Coordinator | null;
  source: MosaicTableSource;
  column: string;
  getFilterExpressions?: () => Array<FilterExpr>;
  onResult: (...values: TResult) => void;
  limit?: number;
  sortMode?: FacetSortMode;
  __debugName?: string;
};
