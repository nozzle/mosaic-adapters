import type { Coordinator, Param, Selection } from '@uwdata/mosaic-core';
import type {
  ColumnDef,
  RowData,
  TableOptions,
  TableState,
} from '@tanstack/table-core';

export type MosaicDataTableSqlFilterType =
  | 'equals'
  | 'in'
  | 'like'
  | 'ilike'
  | 'range';

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
   * The selection that the table writes its own internal filter state to.
   * This allows other Mosaic clients (like charts) to react to table filters.
   * @default undefined
   */
  internalFilter?: Selection | undefined;
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
};
