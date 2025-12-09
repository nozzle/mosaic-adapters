import type { Coordinator, Selection } from '@uwdata/mosaic-core';
import type { SelectQuery } from '@uwdata/mosaic-sql';
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

/**
 * This will be merged into the TanStack Table ColumnDef type
 * to provide Mosaic-specific metadata options.
 *
 * This is pretty much exclusively for TypeScript users to get
 * type safety and autocompletion when defining columns.
 *
 * @example
 * ```ts
 * // tanstack.-table.d.ts
 * import "@tanstack/react-table";
 * import type {
 *  MosaicDataTableColumnDefMetaOptions
 * } from "@nozzleio/mosaic-tanstack-table-core/trimmed";
 *
 * declare module "@tanstack/react-table" {
 *   interface ColumnMeta<TData extends RowData, TValue>
 *     extends MosaicDataTableColumnDefMetaOptions {
 *     // Additional custom meta options can go here too
 *   }
 * }
 * ```
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

/**
 * Defines the source of data for the table.
 * - `string`: A raw table name. Defaults to `SELECT * FROM {string}`.
 * - `() => SelectQuery`: A factory function that returns a Mosaic Query Builder object.
 *   Useful for CTEs, Joins, and Group By aggregations.
 */
export type MosaicTableSource = string | (() => SelectQuery);

export interface MosaicDataTableOptions<
  TData extends RowData,
  TValue = unknown,
> {
  /**
   * The source of data.
   * If a function is provided, it will be treated as a Subquery/View.
   * Pagination and Sorting will be applied to the *result* of this query.
   */
  table: MosaicTableSource;
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
   * The selection that the table writes its own internal filter state to.
   * This allows other Mosaic clients (like charts) to react to table filters.
   * @default undefined
   */
  tableFilterSelection?: Selection | undefined;
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
   * Controls when the table requests a new query.
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
  tableOptions: SubsetTableOptions<TData>;
  /**
   * Internal counter to force React reactivity when sidecar facet data updates.
   * Since the Facet Maps are external to the store state, updating them doesn't
   * naturally trigger a Store update unless we touch a value in the store.
   */
  _facetsUpdateCount: number;
};
