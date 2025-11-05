import {
  MosaicClient,
  queryFieldInfo,
  toDataColumns,
} from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { getCoreRowModel } from '@tanstack/table-core';
import { Store, batch } from '@tanstack/store';
import * as vg from '@uwdata/vgplot';

import type { Coordinator, FieldInfo, Selection } from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { ColumnDef, TableOptions, TableState } from '@tanstack/table-core';

type DebugTableOptions =
  | boolean
  | Array<'cells' | 'columns' | 'headers' | 'rows' | 'table'>;

export interface MosaicDataTableOptions {
  coordinator: Coordinator;
  filterBy?: Selection | undefined;
  debugTable?: DebugTableOptions;
}

export type MosaicDataTableStore = {
  tableState: TableState;
  arrowColumnSchema: Array<FieldInfo>;
  rows: Array<Record<string, any>>;
  totalRows: number | undefined;
};

export function createMosaicDataTableClient(
  tableName: string,
  options: MosaicDataTableOptions,
) {
  const client = new MosaicDataTable(tableName, options);

  options.coordinator.connect(client);

  return client;
}

export class MosaicDataTable extends MosaicClient {
  from = '';
  columns = ['*'];

  schema: Array<FieldInfo> = [];

  #store: Store<MosaicDataTableStore>;
  #debugTable: DebugTableOptions = false;

  constructor(tableName: string, options: MosaicDataTableOptions) {
    super(options.filterBy); // pass appropriate filterSelection if needed
    this.coordinator = options.coordinator;

    if (!tableName) {
      throw new Error('[MosaicDataTable] A table name must be provided.');
    }

    this.#debugTable = options.debugTable ?? false;
    this.from = tableName;
    this.#store = new Store(
      {
        tableState: seedInitialTableState(),
        rows: [] as MosaicDataTableStore['rows'],
        arrowColumnSchema: [] as MosaicDataTableStore['arrowColumnSchema'],
        totalRows: undefined as MosaicDataTableStore['totalRows'],
      },
      {
        onUpdate: () => {},
      },
    );
  }

  override query(filter?: FilterExpr | null | undefined): SelectQuery {
    const pagination = this.#store.state.tableState.pagination;
    const offset = pagination.pageIndex * pagination.pageSize;

    const result = Query.from(this.from)
      .select(['*'], {
        total_rows: vg.count().window(),
      })
      .limit(pagination.pageSize)
      .offset(offset);

    return result;
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
    console.group();
    console.debug('[MosaicDataTable] queryResult() Received data:', data);
    if (data) {
      const dataColumns = toDataColumns(data);

      if ('columns' in dataColumns) {
        const record = dataColumns.columns;

        const columns = Object.entries(record).reduce(
          (acc, [key, value]) => {
            if (key === 'total_rows') {
              if (Array.isArray(value) && value.length > 0) {
                totalRows = Number(value[0]);
              }
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
    console.groupEnd();

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
        const tableState = functionalUpdate(
          updater,
          this.#store.state.tableState,
        );

        this.#store.setState((prev) => ({
          ...prev,
          tableState,
        }));
      },
      manualPagination: true,
      rowCount: state.totalRows,
      debugAll:
        typeof this.#debugTable === 'boolean' && this.#debugTable
          ? true
          : undefined,
      debugCells:
        Array.isArray(this.#debugTable) && this.#debugTable.includes('cells')
          ? true
          : undefined,
      debugHeaders:
        Array.isArray(this.#debugTable) && this.#debugTable.includes('headers')
          ? true
          : undefined,
      debugColumns:
        Array.isArray(this.#debugTable) && this.#debugTable.includes('columns')
          ? true
          : undefined,
      debugRows:
        Array.isArray(this.#debugTable) && this.#debugTable.includes('rows')
          ? true
          : undefined,
      debugTable:
        Array.isArray(this.#debugTable) && this.#debugTable.includes('table')
          ? true
          : undefined,
    };
  }

  get store(): Store<MosaicDataTableStore> {
    return this.#store;
  }
}

function functionalUpdate<T>(updater: T | ((old: T) => T), old: T): T {
  return typeof updater === 'function'
    ? (updater as (old: T) => T)(old)
    : updater;
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
