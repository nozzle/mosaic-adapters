// packages/mosaic-tanstack-table-core/src/types.ts

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
  | (string & {});

export type FacetSortMode = 'alpha' | 'count';

export type ColumnType = 'scalar' | 'array';
export type SqlType =
  | 'VARCHAR'
  | 'INTEGER'
  | 'FLOAT'
  | 'DATE'
  | 'TIMESTAMP'
  | 'BOOLEAN';

// --- Advanced Mapping Types ---

type FilterCompatibility = {
  VARCHAR: 'ILIKE' | 'LIKE' | 'EQUALS' | 'PARTIAL_ILIKE' | 'PARTIAL_LIKE';
  INTEGER: 'RANGE' | 'EQUALS';
  FLOAT: 'RANGE' | 'EQUALS';
  DATE: 'RANGE' | 'EQUALS';
  TIMESTAMP: 'RANGE' | 'EQUALS';
  BOOLEAN: 'EQUALS';
};

/**
 * Configuration for a specific SQL column mapping.
 * Enforces type compatibility between the SQL Type and the Filter Type.
 */
export interface StrictSqlColumnConfig<TType extends SqlType> {
  sqlColumn: string;
  type: TType;
  filterType?: FilterCompatibility[TType] | (string & {});
}

/**
 * Maps TypeScript data keys to SQL column configurations.
 * Enforces strict compatibility between the JS type (TData[Key]) and the SQL configuration.
 */
export type MosaicColumnMapping<TData> = {
  [Key in keyof TData]?: TData[Key] extends number
    ? StrictSqlColumnConfig<'INTEGER' | 'FLOAT'>
    : TData[Key] extends Date
      ? StrictSqlColumnConfig<'DATE' | 'TIMESTAMP'>
      : TData[Key] extends boolean
        ? StrictSqlColumnConfig<'BOOLEAN'>
        : StrictSqlColumnConfig<SqlType>;
};

export interface SqlColumnConfig {
  sqlColumn: string;
  type: SqlType;
  filterType?: MosaicDataTableSqlFilterType;
}

export type FilterValue =
  | { type: 'text'; value: string }
  | { type: 'select'; value: string | number }
  | { type: 'range'; value: [number | null, number | null] }
  | { type: 'date-range'; value: [Date | null, Date | null] };

export type SelectionSource = object;

export interface IMosaicClient {
  readonly isConnected: boolean;
  connect: () => () => void;
  disconnect: () => void;
  setCoordinator: (coordinator: Coordinator) => void;
  __onConnect?: () => void;
  __onDisconnect?: () => void;
}

export interface IMosaicLifecycleHooks {
  __onConnect?: () => void;
  __onDisconnect?: () => void;
}

/**
 * Deprecated: Metadata extensions are being replaced by strict mappings.
 */
export type MosaicDataTableColumnDefMetaOptions = {
  mosaicDataTable?: {
    sqlColumn?: string;
    sqlFilterType?: MosaicDataTableSqlFilterType;
    facetSortMode?: FacetSortMode;
    facet?: 'unique' | 'minmax' | (string & {});
  };
};

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
   */
  schema: ZodType<TData, any, any>;
  /**
   * Strict mapping definition between TypeScript keys and SQL columns.
   */
  mapping?: MosaicColumnMapping<TData>;

  /**
   * Validation strategy for incoming data.
   * 'first': Validate only row 0 (O(1) performance).
   * 'all': Validate every row (O(N) performance).
   * @deprecated 'none' is unsafe and should be avoided.
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
  totalRowsColumnName?: string;
  totalRowsMode?: 'split' | 'window';
  onTableStateChange?: 'requestQuery' | 'requestUpdate';
  __debugName?: string;

  filterStrategies?: Record<string, FilterStrategy>;
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
