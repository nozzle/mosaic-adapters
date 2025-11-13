import type {
  Coordinator,
  FieldInfo,
  Param,
  Selection,
} from '@uwdata/mosaic-core';
import type {
  ColumnDef,
  RowData,
  TableOptions,
  TableState,
} from '@tanstack/table-core';

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
  table: Param<string> | string;
  coordinator?: Coordinator;
  onTableStateChange?: 'requestQuery' | 'requestUpdate';
  filterBy?: Selection | undefined;
  columns?: Array<ColumnDef<TData, TValue>>;
  tableOptions?: Partial<SubsetTableOptions<TData>>;
  /**
   * The column name to use for the total rows count returned from the query.
   * This values will be sanitised to be SQL-safe, so the string provided here
   * may be exactly what is used in the query and result set.
   * @default '__total_rows'
   */
  totalRowsColumnName?: string;
}

export type MosaicDataTableStore<TData extends RowData, TValue = unknown> = {
  columnDefs: Array<ColumnDef<TData, TValue>>;
  tableState: TableState;
  arrowColumnSchema: Array<FieldInfo>;
  rows: Array<TData>;
  totalRows: number | undefined;
  tableOptions: SubsetTableOptions<TData>;
};
