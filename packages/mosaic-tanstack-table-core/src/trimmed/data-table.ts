import {
  MosaicClient,
  isParam,
  queryFieldInfo,
  toDataColumns,
} from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { getCoreRowModel } from '@tanstack/table-core';
import { Store, batch } from '@tanstack/store';
import { functionalUpdate } from './utils';

import type {
  Coordinator,
  FieldInfo,
  FieldInfoRequest,
  Param,
  Selection,
} from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  ColumnDef,
  PaginationState,
  RowData,
  TableOptions,
  TableState,
  VisibilityState,
} from '@tanstack/table-core';

export type DebugTableOptions =
  | boolean
  | Array<'cells' | 'columns' | 'headers' | 'rows' | 'table'>;

export type MosaicDataTableColumnDefOptions = {
  mosaicColumn?: string;
};

export type MosaicDataTableColumnDef<
  TData extends RowData,
  TValue = unknown,
> = ColumnDef<TData, TValue> & MosaicDataTableColumnDefOptions;

export type MosaicTanStackTableInitialState = {
  columnVisibility?: VisibilityState;
  pagination?: PaginationState;
};

export interface MosaicDataTableOptions<
  TData extends RowData,
  TValue = unknown,
> {
  table: Param<string> | string;
  coordinator: Coordinator;
  onTableStateChange?: 'requestQuery' | 'requestUpdate';
  filterBy?: Selection | undefined;
  columns?: Array<MosaicDataTableColumnDef<TData, TValue>>;
  initialState?: MosaicTanStackTableInitialState;
  //
  debugTable?: DebugTableOptions;
}

export type MosaicDataTableStore<TData extends RowData, TValue = unknown> = {
  columns: Array<MosaicDataTableColumnDef<TData, TValue>>;
  tableState: TableState;
  arrowColumnSchema: Array<FieldInfo>;
  rows: Array<TData>;
  totalRows: number | undefined;
};

/**
 * This function creates and initializes a MosaicDataTable client.
 *
 * @typeParam `TData` The row data type used in TanStack Table
 * @typeParam `TValue` The cell value type used in TanStack Table
 * @param options Options to initialize the MosaicDataTable client
 * @returns A initialized MosaicDataTable client
 */
export function createMosaicDataTableClient<
  TData extends RowData,
  TValue = unknown,
>(options: MosaicDataTableOptions<TData, TValue>) {
  // Initialize the table client
  const client = new MosaicDataTable<TData, TValue>(options);

  // Connect to the coordinator
  // So that it can also start piping data from Mosaic to the table
  options.coordinator.connect(client);

  return client;
}

/**
 * A Mosaic Client that does the glue work to drive TanStack Table, using it's
 * TableOptions for configuration.
 */
export class MosaicDataTable<
  TData extends RowData,
  TValue = unknown,
> extends MosaicClient {
  from: Param<string> | string;

  schema: Array<FieldInfo> = [];

  #onTableStateChange: 'requestQuery' | 'requestUpdate' = 'requestUpdate';
  #columnRemaps: Map<string, string> = new Map();

  #store: Store<MosaicDataTableStore<TData, TValue>>;
  #debugTable: DebugTableOptions = false;

  constructor(options: MosaicDataTableOptions<TData, TValue>) {
    super(options.filterBy); // pass the appropriate Filter Selection
    this.coordinator = options.coordinator;

    this.from = options.table;

    // TODO: Figure out the pagination reset when Selection changes.

    if (!this.sourceTable()) {
      throw new Error('[MosaicDataTable] A table name must be provided.');
    }

    type ResolvedStore = MosaicDataTableStore<TData, TValue>;

    this.#store = new Store({
      tableState: seedInitialTableState(options.initialState),
      rows: [] as ResolvedStore['rows'],
      arrowColumnSchema: [] as ResolvedStore['arrowColumnSchema'],
      totalRows: undefined as ResolvedStore['totalRows'],
      columns: options.columns ?? ([] as ResolvedStore['columns']),
    });

    this.updateOptions(options);
  }

  /**
   * When options are updated from framework-land, we need to update
   * the internal store and state accordingly.
   * @param options The updated options from framework-land.
   */
  updateOptions(options: MosaicDataTableOptions<TData, TValue>): void {
    this.#store.setState((prev) => ({
      ...prev,
      columns: options.columns ?? prev.columns,
    }));

    if (options.onTableStateChange) {
      this.#onTableStateChange = options.onTableStateChange;
    }

    if ('debugTable' in options) {
      this.#debugTable = options.debugTable!;
    }
  }

  override query(filter?: FilterExpr | null | undefined): SelectQuery {
    const table = this.sourceTable();
    const pagination = this.#store.state.tableState.pagination;

    // Get the Table SQL columns to select
    const tableColumns = this.sqlColumns();

    // Initialize the main query statement
    // This is where the actual main Columns with Pagination will be applied
    const statement = mSql.Query.from(table).select(...tableColumns, {
      total_rows: mSql.sql`COUNT(*) OVER()`,
    });

    // Conditionally add filter
    if (filter) {
      // TODO: Column filters would be merged here as well
      statement.where(filter);
    }

    // Add pagination at the end
    statement
      .limit(pagination.pageSize)
      .offset(pagination.pageIndex * pagination.pageSize);

    return statement;
  }

  override queryPending(): this {
    return this;
  }

  override queryError(error: Error): this {
    console.error('[MosaicDataTable] queryError() Query error:', error);
    return this;
  }

  override queryResult(data: unknown): this {
    let rows: Array<TData> | undefined = undefined;
    let totalRows: number | undefined = undefined;

    if (data) {
      const dataColumns = toDataColumns(data);

      if ('columns' in dataColumns) {
        const record = dataColumns.columns;

        // TODO: Make this better/simpler. Consider using https://github.com/uwdata/flechette
        const columns = Object.entries(record).reduce(
          (acc, [key, value]) => {
            if (key === 'total_rows') {
              // List may be a typed array, so we should handle the conversion
              let list = value;

              // Convert typed arrays to regular arrays for easier handling
              if (
                list instanceof Float16Array ||
                list instanceof Float32Array ||
                list instanceof Float64Array
              ) {
                list = Array.from(list);
              }

              // Pull out the total rows value
              if (
                Array.isArray(list) &&
                list.length > 0 &&
                typeof list[0] === 'number'
              ) {
                totalRows = list[0];
              }

              // Skip adding this to the row data
              return acc;
            }

            // @ts-expect-error
            acc[key] = value;
            return acc;
          },
          {} as Record<string, Array<any>>,
        );

        const numRows = dataColumns.numRows;
        const processRows: Array<TData> = [];
        for (let i = 0; i < numRows; i++) {
          const row: Record<string, any> = {};
          for (const key in columns) {
            row[key] = columns[key]?.[i];
          }
          // @ts-expect-error
          processRows.push(row);
        }
        rows = processRows;
      }
      if ('values' in dataColumns) {
        const _values = dataColumns.values;
        throw new Error('Data with unnamed values array is not supported yet.');
      }
    }

    batch(() => {
      this.#store.setState((prev) => {
        return {
          ...prev,
          arrowColumnSchema: this.schema,
          rows: rows ?? prev.rows,
          totalRows,
        };
      });
    });

    return this;
  }

  override async prepare(): Promise<void> {
    const schema = await queryFieldInfo(this.coordinator!, this.fields());
    this.schema = schema;

    return Promise.resolve();
  }

  /**
   * Helper utility to build the SQL select columns,
   * taking into account any column remaps defined
   * and other TanStack Table ColumnDef options.
   */
  sqlColumns(): Array<mSql.SelectExpr> {
    // Get the columns to select in SQL-land
    const selectColumns = this.fields()
      .filter((d) => {
        // Exclude any columns that have remaps defined
        if (typeof d.column === 'string' && this.#columnRemaps.has(d.column)) {
          return false;
        }
        return true;
      })
      .map((d) =>
        typeof d.column !== 'string' ? d.column.toString() : d.column,
      );

    // Build remapped columns object for the select statement
    const remappedColumns = Array.from(this.#columnRemaps.entries()).reduce(
      (acc, curr) => {
        const [accessorKey, mosaicColumn] = curr;
        acc[accessorKey] = mosaicColumn;
        return acc;
      },
      {} as Record<string, string>,
    );

    return [selectColumns, remappedColumns];
  }

  /**
   * Resolve the table name based on the constructor options.
   * This is mostly useful if the table name is a Mosaic Param,
   * then it will return the resolved value.
   */
  sourceTable(): string {
    return (isParam(this.from) ? this.from.value : this.from) as string;
  }

  /**
   * Map TanStack Table's ColumnDefs to Mosaic FieldInfoRequests
   * to be used in queries.
   */
  fields(): Array<FieldInfoRequest> {
    const table = this.sourceTable();

    // Filter down the configured TanStack Table ColumnDefs, to just those
    // that can be mapped to Mosaic columns for the query.
    const columns = this.#store.state.columns.filter((d) => {
      // Housekeeping to track the column remaps, when both accessorKey and
      // mosaicColumn are defined but different.
      if (
        'accessorKey' in d &&
        typeof d.accessorKey === 'string' &&
        d.accessorKey.length > 0 &&
        typeof d.mosaicColumn === 'string' &&
        d.mosaicColumn.length > 0 &&
        d.mosaicColumn !== d.accessorKey
      ) {
        this.#columnRemaps.set(d.accessorKey, d.mosaicColumn);
      }

      // If the user has defined a mosaicColumn, we prefer that
      if (typeof d.mosaicColumn === 'string' && d.mosaicColumn.length > 0) {
        return true;
      }

      // If not, but they have defined an accessorKey, we can use that
      if (
        'accessorKey' in d &&
        typeof d.accessorKey === 'string' &&
        d.accessorKey.length > 0
      ) {
        return true;
      }

      // If they have defined an accessorFn, we cannot map that to a Mosaic column
      // so we warn the user that they need to define `mosaicColumn` explicitly
      if ('accessorFn' in d && typeof d.accessorFn === 'function') {
        console.warn(
          `[MosaicDataTable] Column with only \`accessorFn\` cannot be mapped to a Mosaic column without a \`mosaicColumn\` query column identifier. Please define \`mosaicColumn\` on the ColumnDef to map it correctly.\n`,
          d,
        );
        return false;
      }

      // Otherwise, we cannot map this column to a Mosaic column
      return false;
    });

    // If no columns were provided, we default to all columns
    if (columns.length === 0) {
      return [
        {
          table,
          column: '*', // This means "all columns" in Mosaic SQL
        },
      ];
    }

    return columns.map((column) => {
      let accessor = column.mosaicColumn;

      if (!accessor && 'accessorKey' in column) {
        accessor =
          typeof column.accessorKey === 'string'
            ? column.accessorKey
            : column.accessorKey.toString();
      }

      return {
        table,
        column: accessor!,
      };
    });
  }

  /**
   * Map the MosaicDataTableStore state to TanStack TableOptions,
   * with the necessary callbacks to handle state changes and re-querying
   * from Mosaic.
   *
   * @param state The MosaicDataTableStore state from framework-land.
   * @returns Valid TanStack TableOptions for driving a TanStack Table instance in framework-land.
   */
  getTableOptions(
    state: Store<MosaicDataTableStore<TData, TValue>>['state'],
  ): TableOptions<TData> {
    const columns =
      state.columns.length === 0
        ? // No ColDefs were provided, so we default to all columns
          state.arrowColumnSchema.map((field) => {
            return {
              accessorKey: field.column,
              header: field.column,
            } satisfies ColumnDef<TData, TValue>;
          })
        : state.columns.map(({ mosaicColumn: _mosaicColumn, ...column }) => {
            return column satisfies ColumnDef<TData, TValue>;
          });

    return {
      data: state.rows,
      columns,
      getCoreRowModel: getCoreRowModel(),
      state: state.tableState,
      onStateChange: (updater) => {
        // Stored the old hashed table state to compare after update
        const hashedOldState = JSON.stringify(this.#store.state.tableState);

        const tableState = functionalUpdate(
          updater,
          this.#store.state.tableState,
        );

        this.#store.setState((prev) => ({
          ...prev,
          tableState,
        }));

        // Compare the new hashed table state to the old one to determine if we need to request a new query
        const hashedNewState = JSON.stringify(tableState);
        if (hashedOldState !== hashedNewState) {
          this[this.#onTableStateChange]();
        }
      },
      manualPagination: true,
      rowCount: state.totalRows,
      debugAll: this._getDebugTableState('all'),
      debugCells: this._getDebugTableState('cells'),
      debugHeaders: this._getDebugTableState('headers'),
      debugColumns: this._getDebugTableState('columns'),
      debugRows: this._getDebugTableState('rows'),
      debugTable: this._getDebugTableState('table'),
    };
  }

  get store(): Store<MosaicDataTableStore<TData, TValue>> {
    return this.#store;
  }

  private _getDebugTableState(
    key: 'all' | 'cells' | 'headers' | 'columns' | 'rows' | 'table',
  ): true | undefined {
    if (key === 'all') {
      return typeof this.#debugTable === 'boolean' && this.#debugTable
        ? true
        : undefined;
    }
    return Array.isArray(this.#debugTable) && this.#debugTable.includes(key)
      ? true
      : undefined;
  }
}

function seedInitialTableState(
  initial?: MosaicTanStackTableInitialState,
): TableState {
  return {
    pagination: initial?.pagination || {
      pageIndex: 0,
      pageSize: 10,
    },
    columnFilters: [],
    columnVisibility: initial?.columnVisibility || {},
    columnOrder: [] satisfies Array<string>,
    columnPinning: {},
    rowPinning: {},
    globalFilter: '',
    sorting: [],
    expanded: {},
    grouping: [],
    columnSizing: {},
    columnSizingInfo: {
      columnSizingStart: [],
      deltaOffset: null,
      deltaPercentage: null,
      isResizingColumn: false,
      startOffset: null,
      startSize: null,
    },
    rowSelection: {},
  };
}
