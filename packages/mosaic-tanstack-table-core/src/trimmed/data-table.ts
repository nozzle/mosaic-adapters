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
  AccessorKeyColumnDef,
  ColumnDef,
  RowData,
  TableOptions,
  TableState,
} from '@tanstack/table-core';

export type DebugTableOptions =
  | boolean
  | Array<'cells' | 'columns' | 'headers' | 'rows' | 'table'>;

export type MosaicDataTableColumnDef<
  TData extends RowData,
  TValue = unknown,
> = AccessorKeyColumnDef<TData, TValue> & { foo?: string };

export interface MosaicDataTableOptions<
  TData extends RowData,
  TValue = unknown,
> {
  table: Param<string> | string;
  coordinator: Coordinator;
  onTableStateChange?: 'requestQuery' | 'requestUpdate';
  filterBy?: Selection | undefined;
  columns?: Array<MosaicDataTableColumnDef<TData, TValue>>;
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

export class MosaicDataTable<
  TData extends RowData,
  TValue = unknown,
> extends MosaicClient {
  from: Param<string> | string;

  schema: Array<FieldInfo> = [];

  #onTableStateChange: 'requestQuery' | 'requestUpdate' = 'requestUpdate';

  #store: Store<MosaicDataTableStore<TData, TValue>>;
  #debugTable: DebugTableOptions = false;

  constructor(options: MosaicDataTableOptions<TData, TValue>) {
    super(options.filterBy); // pass appropriate filterSelection if needed
    this.coordinator = options.coordinator;

    this.from = options.table;

    // TODO: Figure out the pagination reset when Selection changes.

    if (!this.sourceTable()) {
      throw new Error('[MosaicDataTable] A table name must be provided.');
    }

    type ResolvedStore = MosaicDataTableStore<TData, TValue>;

    this.#store = new Store({
      tableState: seedInitialTableState(),
      rows: [] as ResolvedStore['rows'],
      arrowColumnSchema: [] as ResolvedStore['arrowColumnSchema'],
      totalRows: undefined as ResolvedStore['totalRows'],
      columns: options.columns ?? ([] as ResolvedStore['columns']),
    });

    this.updateOptions(options);
  }

  updateOptions(options: MosaicDataTableOptions<TData, TValue>): void {
    this.#store.setState((prev) => ({
      ...prev,
      columns: options.columns ?? prev.columns,
    }));

    if (options.onTableStateChange) {
      this.#onTableStateChange = options.onTableStateChange;
    }

    this.#debugTable = options.debugTable ?? this.#debugTable;
  }

  override query(filter?: FilterExpr | null | undefined): SelectQuery {
    const table = this.sourceTable();
    const pagination = this.#store.state.tableState.pagination;

    // Get the columns to select in SQL-land
    const selectColumns = this.fields().map((d) =>
      typeof d.column !== 'string' ? d.column.toString() : d.column,
    );

    // Initialize the main query statement
    // This is where the actual main Columns with Pagination will be applied
    const statement = mSql.Query.from(table).select(selectColumns, {
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
        const values = dataColumns.values;
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
   * Get the source table name.
   */
  sourceTable(): string {
    return (isParam(this.from) ? this.from.value : this.from) as string;
  }

  /**
   * Map the React Table columns to the `FieldInfoRequest` format
   */
  fields(): Array<FieldInfoRequest> {
    const table = this.sourceTable();
    const columns = this.#store.state.columns;

    if (columns.length === 0) {
      return [
        {
          table,
          column: '*',
        },
      ];
    }

    return columns.map((column) => {
      let value: string;

      // This is mostly happening to satisfy TypeScript
      if (typeof column.accessorKey === 'string') {
        value = column.accessorKey;
      } else {
        // Fallback to string conversion of accessorKey
        value = column.accessorKey.toString();
      }

      return {
        table,
        column: value,
      };
    });
  }

  /**
   * Get the TanStack Table options to be used with the framework adapters.
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
        : state.columns.map(({ foo: _foo, ...column }) => {
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

function seedInitialTableState(): TableState {
  return {
    pagination: {
      pageIndex: 0,
      pageSize: 10,
    },
    columnFilters: [],
    columnVisibility: {},
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
