/**
 * Type definitions for the Mosaic TanStack Table Core adapter.
 * Defines configuration options, store structures, and metadata extensions.
 */

import type { Coordinator, Param, Selection } from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  ColumnDef,
  RowData,
  TableOptions,
  TableState,
} from '@tanstack/table-core';
import type { FacetStrategy } from './facet-strategies';
import type { FilterStrategy } from './query/filter-factory';
import type { ZodType } from 'zod';

export type MosaicDataTableSqlFilterType =
  | 'EQUALS'
  | 'LIKE'
  | 'PARTIAL_LIKE'
  | 'ILIKE'
  | 'PARTIAL_ILIKE'
  | 'RANGE'
  | (string & {}); // Allow custom string types

export type FacetSortMode = 'alpha' | 'count';

export type ColumnType = 'scalar' | 'array';
export type SqlType =
  | 'VARCHAR'
  | 'INTEGER'
  | 'FLOAT'
  | 'DATE'
  | 'TIMESTAMP'
  | 'BOOLEAN';

/**
 * Configuration for a specific SQL column mapping.
 */
export interface SqlColumnConfig {
  /** The physical database column name (e.g. "user_id" or "meta.created_at") */
  sqlColumn: string;
  /** The SQL data type, used to inform filter coercion logic */
  type: SqlType;
  /** The strategy to use when filtering this column */
  filterType?: MosaicDataTableSqlFilterType;
}

/**
 * Maps TypeScript data keys to SQL column configurations.
 * Enforces that mappings exist for known keys.
 */
export type MosaicColumnMapping<TData> = {
  [Key in keyof TData]?: SqlColumnConfig;
};

/**
 * Discriminated Union for Filter Values.
 * Ensures that strategies receive explicitly typed inputs, not 'unknown'.
 * Range values allow nulls to support open-ended ranges (e.g. "> 5").
 */
export type FilterValue =
  | { type: 'text'; value: string }
  | { type: 'select'; value: string | number }
  | { type: 'range'; value: [number | null, number | null] }
  | { type: 'date-range'; value: [Date | null, Date | null] };

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

/**
 * Deprecated: Metadata extensions are being replaced by strict mappings,
 * but kept for backward compatibility during migration if needed.
 */
export type MosaicDataTableColumnDefMetaOptions = {
  mosaicDataTable?: {
    sqlColumn?: string;
    sqlFilterType?: MosaicDataTableSqlFilterType;
    facetSortMode?: FacetSortMode;
    facet?: 'unique' | 'minmax' | (string & {});
  };
};

/**
 * Interface for Models/Controllers that wish to provide metadata to a MosaicDataTable.
 */
export interface MosaicTableDataProvider {
  getColumnMeta: (
    columnId: string,
  ) => MosaicDataTableColumnDefMetaOptions['mosaicDataTable'] | undefined;
}

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
  /**
   * Runtime schema validator.
   * REQUIRED for strict type safety to prevent runtime crashes from data mismatches.
   * Accepts any input type (from DB) as long as it produces TData.
   */
  schema: ZodType<TData, any, any>;
  /**
   * Strict mapping definition between TypeScript keys and SQL columns.
   */
  mapping?: MosaicColumnMapping<TData>;

  /**
   * Validation strategy for incoming data.
   * 'first': Validate only row 0 (O(1) performance). Good for Production.
   * 'all': Validate every row (O(N) performance). Good for Dev/Debugging.
   * 'none': Trust the DB (Unsafe).
   * @default 'first'
   */
  validationMode?: 'first' | 'all' | 'none';

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

  /**
   * Custom filter strategies to register for this table instance.
   */
  filterStrategies?: Record<string, FilterStrategy>;

  /**
   * Custom facet strategies to register for this table instance.
   */
  facetStrategies?: Record<string, FacetStrategy<any>>;
}

export type MosaicDataTableStore<TData extends RowData, TValue = unknown> = {
  columnDefs: Array<ColumnDef<TData, TValue>>;
  tableState: TableState;
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
