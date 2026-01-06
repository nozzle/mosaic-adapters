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
import type { StrictId } from './types/paths';

// Re-export strict path types
export type { Path, StrictId } from './types/paths';

export type MosaicDataTableSqlFilterType =
  | 'EQUALS'
  | 'LIKE'
  | 'PARTIAL_LIKE'
  | 'ILIKE'
  | 'PARTIAL_ILIKE'
  | 'RANGE'
  | 'DATE_RANGE'
  | 'MATCH'
  | 'SELECT'
  | 'TEXT'
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

export type FilterCompatibility = {
  VARCHAR:
    | 'ILIKE'
    | 'LIKE'
    | 'EQUALS'
    | 'PARTIAL_ILIKE'
    | 'PARTIAL_LIKE'
    | 'MATCH'
    | 'TEXT'
    | 'SELECT';
  INTEGER: 'RANGE' | 'EQUALS' | 'MATCH' | 'SELECT';
  FLOAT: 'RANGE' | 'EQUALS' | 'MATCH' | 'SELECT';
  DATE: 'RANGE' | 'DATE_RANGE' | 'EQUALS' | 'MATCH' | 'SELECT';
  TIMESTAMP: 'RANGE' | 'DATE_RANGE' | 'EQUALS' | 'MATCH' | 'SELECT';
  BOOLEAN: 'EQUALS' | 'MATCH' | 'SELECT';
};

export interface FilterOptions {
  /**
   * If true, input strings (likely from local datetime inputs) will be converted
   * to UTC ISO strings before being sent to the database.
   * Use this when your database stores UTC timestamps but users input Local time.
   */
  convertToUTC?: boolean;
}

/**
 * Configuration for a specific SQL column mapping.
 * Enforces type compatibility between the SQL Type and the Filter Type.
 */
export interface StrictSqlColumnConfig<TType extends SqlType> {
  sqlColumn: string;
  type: TType;
  filterType?: FilterCompatibility[TType] | (string & {});
  filterOptions?: FilterOptions;
}

/**
 * Maps TypeScript data keys to SQL column configurations.
 * Enforces strict compatibility between the JS type (TData[Key]) and the SQL configuration.
 * Keys must be valid StrictIds (direct keys or nested paths).
 *
 * NOTE: This type is generally constructed via createMosaicMapping factory
 * to ensure Zod inference logic is applied.
 */
export type MosaicColumnMapping<TData> = Partial<
  Record<
    StrictId<TData>,
    | StrictSqlColumnConfig<'INTEGER'>
    | StrictSqlColumnConfig<'FLOAT'>
    | StrictSqlColumnConfig<'DATE'>
    | StrictSqlColumnConfig<'TIMESTAMP'>
    | StrictSqlColumnConfig<'BOOLEAN'>
    | StrictSqlColumnConfig<'VARCHAR'>
    | StrictSqlColumnConfig<SqlType>
  >
>;

export interface SqlColumnConfig {
  sqlColumn: string;
  type: SqlType;
  filterType?: MosaicDataTableSqlFilterType;
}

/**
 * Discriminated Union for Filter Inputs.
 * Strictly enforces the shape of the value based on the filter mode.
 * Now supports nullable bounds for open-ended ranges.
 */
export type FilterInput =
  | { mode: 'TEXT'; value: string }
  | { mode: 'MATCH'; value: string | number | boolean }
  | { mode: 'RANGE'; value: [number | null, number | null] }
  | { mode: 'DATE_RANGE'; value: [string | null, string | null] } // Enforce ISO Strings
  | { mode: 'SELECT'; value: string | number | boolean }; // Single select

export type FilterMode = FilterInput['mode'];

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
    column: StrictId<TData>; // Enforce StrictId
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
  facetStrategies?: Record<string, FacetStrategy<any, any>>;
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
