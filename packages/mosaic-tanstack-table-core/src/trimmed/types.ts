// packages/mosaic-tanstack-table-core/src/trimmed/types.ts
// This file centralizes the TypeScript definitions for the trimmed Mosaic-TanStack core.
// It defines the shape of the internal store, configuration options, and custom
// metadata extensions for TanStack Table to support SQL mapping.
import type { Coordinator, Param, Selection } from '@uwdata/mosaic-core';
import type {
  ColumnDef,
  RowData,
  TableOptions,
  TableState,
} from '@tanstack/table-core';

export type MosaicDataTableSqlFilterType =
  | 'equals' // = value (Exact match, good for IDs, Numbers)
  | 'in' // IN (v1, v2) (Good for Select/Multi-select)
  | 'like' // LIKE %value% (Case sensitive text)
  | 'ilike' // ILIKE %value% (Case insensitive text)
  | 'range'; // >= min AND <= max (Good for Sliders, Dates)

// Type for storing faceted values: ColumnID -> Map<Value, Count>
export type FacetMap = Map<string, Map<any, number>>;

// Type for storing faceted min/max: ColumnID -> [Min, Max]
export type MinMaxTuple = [number | null, number | null];

/**
 * This will be merged into the TanStack Table ColumnDef type
 * to provide Mosaic-specific metadata options.
 */
export type MosaicDataTableColumnDefMetaOptions = {
  mosaicDataTable?: {
    /**
     * The SQL column name to map this column definition to
     * in Mosaic queries.
     */
    sqlColumn?: string;
    /**
     * The SQL filter type to use for this column when
     * generating Mosaic queries.
     */
    sqlFilterType?: MosaicDataTableSqlFilterType;
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

export interface MosaicDataTableOptions<
  TData extends RowData,
  TValue = unknown,
> {
  /**
   * The Mosaic Data Table to use as the data source for the table instance.
   */
  table: Param<string> | string;
  /**
   * Mosaic Coordinator instance to connect to for querying data.
   */
  coordinator?: Coordinator;
  /**
   * Parent selection to apply to the Mosaic query for filtering rows.
   * @default undefined
   */
  filterBy?: Selection | undefined;
  /**
   * Selection to write internal table filters (column filters) to.
   * This allows the table to filter other visuals.
   * @default undefined
   */
  internalFilter?: Selection | undefined;
  /**
   * Selection to update when a row is hovered.
   * Used for cross-highlighting.
   * @default undefined
   */
  hoverAs?: Selection | undefined;
  /**
   * Selection to update when a row is clicked.
   * @default undefined
   */
  clickAs?: Selection | undefined;
  /**
   * The primary key column(s) of the data.
   * Used to identify rows uniquely for hover/click predicates.
   * @default ['id']
   */
  primaryKey?: string[];
  /**
   * Column Definitions to use for the table instance.
   *
   * When not provided, the column definitions will be inferred
   * from the data source schema.
   * @default undefined
   */
  columns?: Array<ColumnDef<TData, TValue>>;
  /**
   * Additional TanStack Table options to apply to the table instance.
   *
   * @default {}
   */
  tableOptions?: Partial<SubsetTableOptions<TData>>;
  /**
   * The column name to use for the total rows count returned from the query.
   * This values will be sanitised to be SQL-safe, so the string provided here
   * may be exactly what is used in the query and result set.
   *
   * @default '__total_rows'
   */
  totalRowsColumnName?: string;
  /**
   * TODO: Add description
   *
   * @default 'requestUpdate'
   */
  onTableStateChange?: 'requestQuery' | 'requestUpdate';
}

export type MosaicDataTableStore<TData extends RowData, TValue = unknown> = {
  columnDefs: Array<ColumnDef<TData, TValue>>;
  tableState: TableState;
  rows: Array<TData>;
  totalRows: number | undefined;
  // Store for server-fetched facets. Key = columnId, Value = Map of (Value -> Count)
  facets: FacetMap;
  // Store for Range bounds (Sliders). Key = ColumnId, Value = [Min, Max]
  facetMinMax: Map<string, MinMaxTuple>;
  tableOptions: SubsetTableOptions<TData>;
};