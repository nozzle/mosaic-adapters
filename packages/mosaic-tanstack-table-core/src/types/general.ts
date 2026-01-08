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
import type { FacetStrategy } from '../facet-strategies';
import type { FilterStrategy } from '../query/filter-factory';

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

// --- Type Safety Utilities ---

type UnwrapNullable<T> = T extends null | undefined
  ? never
  : T extends Array<infer U>
    ? U
    : T;

/**
 * Maps a TypeScript Value to allowed SQL Filter Types.
 * This enforces that you cannot use text filters on number columns, etc.
 */
export type AllowedFilterTypeFor<TValue> =
  UnwrapNullable<TValue> extends number
    ? 'RANGE' | 'EQUALS' | 'MATCH' | 'SELECT'
    : UnwrapNullable<TValue> extends Date
      ? 'DATE_RANGE' | 'RANGE' | 'EQUALS'
      : UnwrapNullable<TValue> extends boolean
        ? 'EQUALS' | 'MATCH' | 'SELECT'
        : // Strings / Default
            | 'ILIKE'
            | 'LIKE'
            | 'PARTIAL_ILIKE'
            | 'PARTIAL_LIKE'
            | 'EQUALS'
            | 'MATCH'
            | 'TEXT'
            | 'SELECT';

/**
 * Maps a TypeScript Value to allowed Facet Types.
 */
export type AllowedFacetTypeFor<TValue> =
  UnwrapNullable<TValue> extends number | Date ? 'minmax' | 'unique' : 'unique';

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
 * Keys are simple strings representing the column ID or path.
 */
// eslint-disable-next-line unused-imports/no-unused-vars
export type MosaicColumnMapping<TData> = Partial<
  Record<
    string,
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
 */
export type FilterInput =
  | { mode: 'TEXT'; value: string }
  | { mode: 'MATCH'; value: string | number | boolean }
  | { mode: 'RANGE'; value: [number | null, number | null] }
  | { mode: 'DATE_RANGE'; value: [string | null, string | null] }
  | { mode: 'SELECT'; value: string | number | boolean };

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
 * Metadata definition for ColumnDefs.
 * Now Generic on TValue to enforce strict typing of SQL properties.
 */
export type MosaicDataTableColumnDefMetaOptions<TValue = unknown> = {
  mosaicDataTable?: {
    sqlColumn?: string;
    /**
     * The SQL Filter Type.
     * STRICTLY TYPED based on the column's data type (TValue).
     */
    sqlFilterType?: AllowedFilterTypeFor<TValue> | (string & {});
    facetSortMode?: FacetSortMode;
    /**
     * The Facet Type.
     * STRICTLY TYPED based on the column's data type (TValue).
     */
    facet?: AllowedFacetTypeFor<TValue> | (string & {});
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
   * Optional converter to transform raw database rows into the application TData shape.
   * Useful for date coercion or custom parsing.
   */
  converter?: (row: Record<string, unknown>) => TData;

  /**
   * Strict mapping definition between TypeScript keys and SQL columns.
   */
  mapping?: MosaicColumnMapping<TData>;

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
  facetStrategies?: Record<string, FacetStrategy<any, any>>;
}

/**
 * Extended options interface for framework adapters (React, Vue, etc.)
 * that requires the strict mapping to be present.
 */
export interface StrictMosaicDataTableOptions<
  TData extends RowData,
  TValue = unknown,
> extends MosaicDataTableOptions<TData, TValue> {
  mapping: MosaicColumnMapping<TData>;
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
