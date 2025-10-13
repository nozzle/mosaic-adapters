import { coordinator, MosaicClient, toDataColumns } from '@uwdata/mosaic-core';
import {
    Table,
    TableOptions,
    createTable,
    ColumnDef,
    SortingState,
    Updater,
    TableState,
    getCoreRowModel
} from '@tanstack/table-core';

export interface DataTableOptions<TData = unknown> extends Omit<TableOptions<TData>, 'data' | 'columns'> {
  coordinator?: any;
  columns?: ColumnDef<TData>[];
  data?: TData[];
}

export class DataTable<TData = unknown> extends MosaicClient {
  private _table: Table<TData>;
  private _columns: ColumnDef<TData>[];
  private _data: TData[];
  public _coordinator: any;

  constructor(options: DataTableOptions<TData>) {
    super();
    this._columns = options.columns || [];
    this._data = options.data || [];

    // Create table with required options
    this._table = createTable({
      data: this._data,
      columns: this._columns,
      getCoreRowModel: getCoreRowModel(),
      renderFallbackValue: null,
      state: {},
      onStateChange: (updater) => {
        if (options.onStateChange) options.onStateChange(updater);
        this._handleTableStateChange(updater);
      },
      // Spread options after core properties to avoid conflicts
      ...Object.fromEntries(Object.entries(options).filter(([key]) =>
        !['data', 'columns', 'getCoreRowModel', 'onStateChange'].includes(key)
      ))
    });

    // Use the coordinator from options or default coordinator
    this._coordinator = options.coordinator || coordinator;
    if (this._coordinator) {
      this._coordinator.connect?.(this);
    }
  }

  // Add the missing requestQuery method with correct signature
  requestQuery(query?: any): Promise<unknown> | null {
    // Request new query data from coordinator
    if (this._coordinator && this._coordinator.requestQuery) {
      return this._coordinator.requestQuery(this, query);
    }
    return null;
  }

  // Called by MosaicClient when query results arrive
  queryResult(data: unknown): this {
    const dataColumns = toDataColumns(data);

    // Convert DataColumns to array format for TanStack Table
    const rows: TData[] = [];

    if ('columns' in dataColumns) {
      // Handle named columns format
      for (let i = 0; i < dataColumns.numRows; i++) {
        const row: Record<string, unknown> = {};
        for (const [key, column] of Object.entries(dataColumns.columns)) {
          row[key] = Array.isArray(column) ? column[i] : column;
        }
        rows.push(row as TData);
      }
    } else if ('values' in dataColumns) {
      // Handle values array format
      for (let i = 0; i < dataColumns.numRows; i++) {
        const value = Array.isArray(dataColumns.values) ? dataColumns.values[i] : dataColumns.values;
        rows.push(value as TData);
      }
    }

    this._data = rows;
    // Recreate table with new data since TanStack Table doesn't have setData
    this._table = createTable({
      ...this._table.options,
      data: this._data,
    });

    return this;
  }

  // Called by MosaicClient when a query is pending
  queryPending(): this {
    // Update table state to indicate loading if needed
    return this;
  }

  // Handle TanStack Table state changes and sync with Mosaic
  private _handleTableStateChange(updater: Updater<TableState>) {
    const prevState = this._table.getState();
    const newState = typeof updater === 'function' ? updater(prevState) : updater;

    // Sync sorting
    if (newState.sorting !== prevState.sorting) {
      this._updateMosaicSorting(newState.sorting);
    }

    // Sync global filter
    if (newState.globalFilter !== prevState.globalFilter) {
      this._updateMosaicFilter(newState.globalFilter);
    }
  }

  private _updateMosaicSorting(sorting: SortingState) {
    // Trigger a query update when sorting changes
    this.requestQuery();
  }

  private _updateMosaicFilter(filter: unknown) {
    // Trigger a query update when filtering changes
    this.requestQuery();
  }

  get table() {
    return this._table;
  }

  get coordinator() {
    return this._coordinator;
  }
}
