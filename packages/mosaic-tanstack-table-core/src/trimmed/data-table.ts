import {
  MosaicClient,
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
  Param,
  Selection,
} from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { ColumnDef, TableOptions, TableState } from '@tanstack/table-core';

type DebugTableOptions =
  | boolean
  | Array<'cells' | 'columns' | 'headers' | 'rows' | 'table'>;

export interface MosaicDataTableOptions {
  table: string;
  coordinator: Coordinator;
  onTableStateChange?: 'requestQuery' | 'requestUpdate';
  filterBy?: Selection | undefined;
  selections?: Record<string, Selection>;
  params?: Record<string, Param<unknown>>;
  //
  debugTable?: DebugTableOptions;
}

export type MosaicDataTableStore = {
  tableState: TableState;
  arrowColumnSchema: Array<FieldInfo>;
  rows: Array<Record<string, any>>;
  totalRows: number | undefined;
};

export function createMosaicDataTableClient(options: MosaicDataTableOptions) {
  // Initialize the table client
  const client = new MosaicDataTable(options);

  // Connect to the coordinator
  // So that it can also start piping data from Mosaic to the table
  options.coordinator.connect(client);

  return client;
}

export class MosaicDataTable extends MosaicClient {
  from = '';
  columns = ['*'];

  schema: Array<FieldInfo> = [];

  #onTableStateChange: 'requestQuery' | 'requestUpdate' = 'requestUpdate';

  #store: Store<MosaicDataTableStore>;
  #debugTable: DebugTableOptions = false;

  constructor(options: MosaicDataTableOptions) {
    super(options.filterBy); // pass appropriate filterSelection if needed
    this.coordinator = options.coordinator;

    if (!options.table) {
      throw new Error('[MosaicDataTable] A table name must be provided.');
    }

    this.#debugTable = options.debugTable ?? false;
    this.#onTableStateChange = options.onTableStateChange ?? 'requestUpdate';

    this.from = options.table;

    this.#store = new Store({
      tableState: seedInitialTableState(),
      rows: [] as MosaicDataTableStore['rows'],
      arrowColumnSchema: [] as MosaicDataTableStore['arrowColumnSchema'],
      totalRows: undefined as MosaicDataTableStore['totalRows'],
    });
  }

  override query(filter?: FilterExpr | null | undefined): SelectQuery {
    const pagination = this.#store.state.tableState.pagination;
    const offset = pagination.pageIndex * pagination.pageSize;

    // Get the columns to select in SQL-land
    const selectColumns = ['*'];

    // Create a separate count statement to get the total rows
    // without pagination applied
    // We'll be calling this as a CTE and referencing it in the main query below named "total_count_table"
    const countStatement = mSql.Query.from(this.from).select({
      total: mSql.count(),
    });

    // Initialize the main query statement
    // This is where the actual main Columns with Pagination will be applied
    const statement = mSql.Query.from(this.from).select(selectColumns, {
      // Select the column total from the CTE named total_count_table and alias it as total_rows
      total_rows: mSql.sql`(SELECT total FROM total_count_table)`,
    });

    // Conditionally add filter
    if (filter) {
      statement.where(filter);
      countStatement.where(filter);
    }

    // Attach the total count statement, the output would look something like this:
    //
    // WITH "total_count_table" AS (SELECT count(*) AS "total" FROM "athletes")
    // SELECT *, (SELECT total FROM total_count_table) AS "total_rows"
    // FROM "athletes"
    // LIMIT 10
    // OFFSET 0
    statement.with({ total_count_table: countStatement });

    // Add pagination at the end
    statement.limit(pagination.pageSize).offset(offset);

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
    let rows: Array<Record<string, unknown>> | undefined = undefined;
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
          {} as Record<string, Array<unknown>>,
        );

        const numRows = dataColumns.numRows;
        const processRows: Array<Record<string, unknown>> = [];
        for (let i = 0; i < numRows; i++) {
          const row: Record<string, unknown> = {};
          for (const key in columns) {
            row[key] = columns[key]?.[i];
          }
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
    const table = this.from;
    const fields = this.columns.map((column) => ({
      column,
      table,
    }));
    const schema = await queryFieldInfo(this.coordinator!, fields);
    this.schema = schema;

    return Promise.resolve();
  }

  /**
   * Get the TanStack Table options to be used with the framework adapters.
   */
  getTableOptions(
    state: Store<MosaicDataTableStore>['state'],
  ): TableOptions<unknown> {
    const columns = state.arrowColumnSchema.map((field) => {
      return {
        accessorKey: field.column,
        header: field.column,
      } satisfies ColumnDef<Record<string, any>>;
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

  get store(): Store<MosaicDataTableStore> {
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
