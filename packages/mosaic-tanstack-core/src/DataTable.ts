// packages/mosaic-tanstack-core/src/DataTable.ts
// This file defines the core, framework-agnostic DataTable class, which serves
// as the bridge between the Mosaic data client architecture and the Tanstack Table
// UI state management engine. It extends MosaicClient and manages the lifecycle,
// state synchronization, and data fetching logic.
import { MosaicClient, Selection, type FilterExpr } from '@uwdata/mosaic-core';
import { Query, literal } from '@uwdata/mosaic-sql';
import * as vg from '@uwdata/vgplot';
import { createTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel, getGroupedRowModel, type Table } from '@tanstack/table-core';
import { Logger, createPredicateFromRowId } from './util';
import { handleStateUpdate, generateFilterPredicates } from './state';
import { query, queryResult } from './mosaic';
import {
    type DataTableOptions, type MosaicColumnDef, type TableState, type InteractionConfig,
    type DataTableSnapshot, type LoadingState, QueryType
} from './types';

export abstract class DataTable<TData extends object = any> extends MosaicClient {
  // Public properties for modules, not intended for external use
  public readonly logger: Logger;
  public readonly sourceName: string;
  public sourceTable?: string;
  public filterBy?: Selection;
  public internalFilterSelection?: Selection;
  public rowSelectionSelection?: Selection;
  public hoverSelection?: Selection;
  public clickSelection?: Selection;
  public hoverInteraction?: InteractionConfig<TData>;
  public clickInteraction?: InteractionConfig<TData>;
  public readonly groupByKeys: string[];
  public readonly primaryKey: string[];
  public readonly columns: MosaicColumnDef<TData>[];
  public readonly table: Table<TData>;
  public readonly chunkSize: number;
  
  // State properties managed by the class and its modules
  public data: TData[];
  public state: TableState;
  public schema = new Map<string, any>();
  public rowSelectionPredicates = new Map<string, any>();
  public error: Error | null = null;
  public loadingState: LoadingState = 'idle';
  public offset = 0;
  public isDataLoaded = false;
  public totalRows = -1;
  public isInitialized = false;
  public initialFetchDispatched = false;
  public pendingQueryOffset: number | null = null;
  public isPrefetching = false;
  public _lastExternalFilter?: string;

  private _options: Omit<any, 'data' | 'columns' | 'state' | 'onStateChange' | 'renderFallbackValue'>;
  private _listeners = new Set<() => void>();
  private _snapshot: DataTableSnapshot<TData>;
  
  constructor(options: DataTableOptions<TData>) {
    super(options.filterBy);
    const { 
        logic, ui = {}, initialState, filterBy, internalFilter, rowSelectionAs,
        hoverAs, clickAs
    } = options;
    
    this._options = logic.options || {};
    this.sourceName = logic.name || this.constructor.name;
    this.logger = new Logger(this.sourceName);

    this.sourceTable = logic.sourceTable;
    this.filterBy = filterBy;
    this.internalFilterSelection = internalFilter;
    this.rowSelectionSelection = rowSelectionAs;
    this.hoverSelection = hoverAs;
    this.clickSelection = clickAs;
    this.hoverInteraction = logic.hoverInteraction;
    this.clickInteraction = logic.clickInteraction;
    this.groupByKeys = logic.groupBy || [];
    this.primaryKey = logic.primaryKey || [];

    const enableRowSelection = (this._options as any).enableRowSelection;
    if (enableRowSelection && (!this.primaryKey || this.primaryKey.length === 0)) {
        const errorMsg = `'enableRowSelection' is true, but a 'primaryKey' array was not provided in the logic config.`;
        this.logger.error(errorMsg);
        throw new Error(`[${this.sourceName}] ${errorMsg}`);
    }

    this.columns = logic.columns.map(logicCol => {
        const uiCol = ui[logicCol.id] || {};
        return {
            ...logicCol,
            ...uiCol,
            meta: {
                ...(logicCol.meta || {}),
                ...(uiCol.meta || {}),
            }
        };
    });
    
    this.data = [];
    
    this.state = {
      columnFilters: [], columnOrder: [], columnPinning: { left: [], right: [] },
      columnSizing: {}, columnVisibility: {}, expanded: {}, globalFilter: undefined,
      grouping: [], 
      pagination: { pageIndex: 0, pageSize: 500 }, 
      rowSelection: {}, sorting: [], isSelectAll: false, ...initialState,
    };
    this.chunkSize = this.state.pagination.pageSize;
    this.isPrefetching = false;

    if (!this.hoverInteraction && this.primaryKey.length > 0) {
        this.hoverInteraction = { createPredicate: (row) => createPredicateFromRowId(JSON.stringify(this.primaryKey.map(k => (row as any)[k])), this.primaryKey, this.logger) };
    }
    if (!this.clickInteraction && this.primaryKey.length > 0) {
        this.clickInteraction = { createPredicate: (row) => createPredicateFromRowId(JSON.stringify(this.primaryKey.map(k => (row as any)[k])), this.primaryKey, this.logger) };
    }
    
    this.table = this._createTable();

    this._snapshot = {
        table: this.table, data: this.data, totalRows: 0,
        isDataLoaded: this.isDataLoaded, isFetching: true, isLookupPending: false, error: this.error,
    };
  }

  private _createTable(): Table<TData> {
    const tableOptions = {
      ...this._options,
      meta: {
        ...(this._options.meta as object),
        onRowHover: this.handleRowHover, onRowClick: this.handleRowClick,
        hasGlobalFilter: this.columns.some(c => c.meta?.enableGlobalFilter),
        toggleSelectAll: (value: boolean) => this.toggleSelectAll(value),
      },
      data: this.data, columns: this.columns, state: this.state,
      pageCount: this.totalRows > 0 ? Math.ceil(this.totalRows / this.state.pagination.pageSize) : -1,
      onStateChange: (updater: any) => handleStateUpdate(this, updater),
      manualSorting: true, manualFiltering: true, manualPagination: true, manualGrouping: true,
      renderFallbackValue: null,
      getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
      getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(),
      getGroupedRowModel: getGroupedRowModel(),
      enableColumnResizing: true, columnResizeMode: 'onChange', enableMultiRowSelection: true,
      getRowId: (this.primaryKey.length > 0) ? (row: TData) => JSON.stringify(this.primaryKey.map(key => (row as any)[key])) : undefined
    };
    return createTable<TData>(tableOptions);
  }

  // --- Public API & Lifecycle ---

  public connect(): () => void {
    this.logger.log('LIFECYCLE: Connecting to coordinator...');
    this.isInitialized = true;
    vg.coordinator().connect(this);
    this.initializeSelections();
    return () => this.destroy();
  }

  public destroy() {
    this.logger.log('LIFECYCLE: Destroying client and disconnecting from coordinator.');
    this.isInitialized = false;
    const source = this.sourceName;
    if (this.internalFilterSelection) this.internalFilterSelection.update({ source, predicate: null });
    if (this.rowSelectionSelection) this.rowSelectionSelection.update({ source, predicate: null });
    if (this.hoverSelection) this.hoverSelection.update({ source, predicate: null });
    if (this.clickSelection) this.clickSelection.update({ source, predicate: null });
    if (this.coordinator) this.coordinator.disconnect(this);
    this._listeners.clear();
  }
  
  public fetchNextChunk() {
    if (this.loadingState !== 'idle' || this.isDataLoaded || !this.initialFetchDispatched) return;
    this.logger.log('VIRTUALIZER: Request to fetch next chunk received.');
    const query = this.query(this.filterBy?.predicate(this), { type: QueryType.DATA });
    if (query) {
        this.pendingQueryOffset = this.offset;
        this.requestQuery(query);
    }
  }

  public async goToLastPage(): Promise<void> {
    this.logger.log('PAGINATION: `goToLastPage` called.');
    if (this.loadingState !== 'idle') {
        this.logger.warn('PAGINATION: Already busy, ignoring `goToLastPage` request.');
        return;
    }

    let total = this.totalRows;
    if (total === -1) {
        this.logger.log('PAGINATION: Total rows unknown, fetching count...');
        total = await this._fetchTotalRows();
    }

    if (total > 0) {
        const { pageSize } = this.state.pagination;
        const lastPageIndex = Math.floor((total - 1) / pageSize);
        if (lastPageIndex !== this.state.pagination.pageIndex) {
            this.logger.log(`PAGINATION: Navigating to last page index: ${lastPageIndex}`);
            handleStateUpdate(this, old => ({
                ...old,
                pagination: { ...old.pagination, pageIndex: lastPageIndex },
            }));
        } else {
            this.logger.log('PAGINATION: Already on the last page.');
        }
    }
  }

  private async _fetchTotalRows(): Promise<number> {
    this.loadingState = 'lookup'; // Use 'lookup' to show a distinct loading state
    this.notifyListeners();
    try {
        const countQuery = this.query(this.filterBy?.predicate(this), { type: QueryType.TOTAL_COUNT });
        if (!countQuery) throw new Error('Could not construct count query.');

        const result = await this.coordinator.query(countQuery);
        const total = result.get(0)?.total_rows;

        if (typeof total === 'number') {
            this.logger.log(`PAGINATION: Fetched total rows: ${total}`);
            this.totalRows = total;
            this.table.setOptions(prev => ({
                ...prev,
                pageCount: Math.ceil(this.totalRows / this.state.pagination.pageSize),
            }));
            return total;
        } else {
            throw new Error('Count query returned invalid result.');
        }
    } catch (err) {
        this.queryError(err as Error);
        return -1;
    } finally {
        if (this.loadingState === 'lookup') {
            this.loadingState = 'idle';
            this.notifyListeners();
        }
    }
  }

  // --- Subscription ---

  public subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  public getSnapshot = (): DataTableSnapshot<TData> => this._snapshot;

  public notifyListeners = () => {
    const totalStr = this.totalRows > -1 ? this.totalRows.toLocaleString() : '...';
    this.logger.log(
      `UI_UPDATE: Showing ${this.data.length.toLocaleString()} of ${totalStr} rows. Status: ${this.loadingState}.`
    );

    this._snapshot = {
        table: this.table, data: this.data, totalRows: this.totalRows,
        isDataLoaded: this.isDataLoaded, isFetching: this.loadingState === 'fetching',
        isLookupPending: this.loadingState === 'lookup', error: this.error,
    };
    this._listeners.forEach(listener => listener());
  }

  // --- Interaction Handlers ---

  public initializeSelections() {
    this.logger.log('LIFECYCLE: Initializing output selections (hover, click).');
    if (this.hoverSelection) this.hoverSelection.update({ source: this.sourceName, predicate: literal(false) });
    if (this.clickSelection) this.clickSelection.update({ source: this.sourceName, predicate: null });
  }

  public handleRowHover = (rowObject: TData | null): void => {
    if (this.hoverSelection && this.hoverInteraction) {
      const predicate = rowObject ? this.hoverInteraction.createPredicate(rowObject) : literal(false);
      this.hoverSelection.update({ source: this.sourceName, predicate });
    }
  }

  public handleRowClick = (rowObject: TData | null): void => {
    if (this.clickSelection && this.clickInteraction) {
      const predicate = rowObject ? this.clickInteraction.createPredicate(rowObject) : null;
      this.clickSelection.update({ source: this.sourceName, predicate });
    }
  }

  public toggleSelectAll = (value: boolean) => {
    this.logger.log(`STATE: Toggling "Select All" to ${value}.`);
    handleStateUpdate(this, old => ({ ...old, isSelectAll: value, rowSelection: value ? old.rowSelection : {} }));
  };

  // --- MosaicClient Implementation (Delegated) ---

  public abstract getBaseQuery(filters: { where?: any, having?: any }): Query;
  
  fields() { return null; }
  fieldInfo() {}

  filter(filter: FilterExpr): void {
    const currentFilterString = filter ? String(filter) : '[]';
    const lastFilterString = this._lastExternalFilter ?? '[]';

    if (currentFilterString !== lastFilterString) {
        this.logger.log(`MOSAIC EVENT: External filter changed. Requesting throttled update.`);
        this._lastExternalFilter = currentFilterString;

        this.data = [];
        this.offset = 0;
        this.isDataLoaded = false;
        this.isPrefetching = false;
        this.initialFetchDispatched = true;

        if (this.state.pagination.pageIndex !== 0) {
            const newState = {
                ...this.state,
                pagination: { ...this.state.pagination, pageIndex: 0 },
            };
            this.state = newState;
            this.table.setOptions(prev => ({ ...prev, state: this.state }));
        }
        
        this.requestUpdate();
    }
  }

  query(filter?: FilterExpr, options?: any): Query | null {
    return query(this, filter, options);
  }

  queryResult = (data: any, query?: any) => queryResult(this, data, query);
  
  public queryPending = () => {
    this.logger.log('MOSAIC: `queryPending()` called. Setting state to fetching.');
    this.loadingState = 'fetching';
    this.error = null;
    this.notifyListeners();
    return this;
  }
  
  public queryError = (error: Error) => {
    this.logger.error('MOSAIC: `queryError()` called.', error);
    this.loadingState = 'idle';
    this.error = error;
    this.notifyListeners();
    return this;
  }
  
  public _generateFilterPredicates = (state: TableState) => generateFilterPredicates(this);

  get filterStable(): boolean { return false; }
}