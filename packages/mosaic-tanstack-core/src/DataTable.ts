// packages/mosaic-tanstack-core/src/DataTable.ts
/**
 * @file This file defines the generic, framework-agnostic `DataTable` base class.
 * It acts as a bridge, extending MosaicClient to handle data fetching and
 * implementing a subscription model to push state updates to any UI framework.
 * This version implements a hybrid "jump-to-page" and "grow-on-demand" model,
 * and includes logic to prevent redundant queries on initial load.
 */
import { MosaicClient, Selection, type FilterExpr } from '@uwdata/mosaic-core';
import { literal, and, sql, or, Query, desc, asc, eq, not, type SQLAst } from '@uwdata/mosaic-sql';
import * as vg from '@uwdata/vgplot';
import { 
    createTable, 
    getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel, getGroupedRowModel,
    type Table, type TableOptions, type ColumnDef, type TableState, type Updater
} from '@tanstack/table-core';
import { Table as ArrowTable } from 'apache-arrow';

// --- UTILITY ---
// A simple logger class to provide prefixed and timestamped console logs for debugging.
class Logger {
    constructor(private prefix: string) {}
    log(...args: any[]) {
        console.log(`[${this.prefix} - ${new Date().toLocaleTimeString()}]`, ...args);
    }
    warn(...args: any[]) {
        console.warn(`[${this.prefix} - ${new Date().toLocaleTimeString()}]`, ...args);
    }
    error(...args: any[]) {
        console.error(`[${this.prefix} - ${new Date().toLocaleTimeString()}]`, ...args);
    }
}

// --- GENERIC TYPE DEFINITIONS ---

/**
 * Extends TanStack Table's `TableMeta` to include custom properties, such as
 * callbacks for row interactions.
 */
export interface CustomTableMeta<TData extends object> {
    onRowHover?: (row: TData | null) => void;
    onRowClick?: (row: TData | null) => void;
    hasGlobalFilter?: boolean;
    toggleSelectAll?: (value: boolean) => void;
}

/**
 * Extends TanStack Table's `ColumnMeta` to include custom properties, such as
 * a placeholder for a filter component UI and a flag for global searchability.
 */
export interface CustomColumnMeta<TData extends object, TValue> {
    Filter?: any; // Generic placeholder for a filter component, framework-agnostic.
    enableGlobalFilter?: boolean;
}

/**
 * Use module augmentation to merge our custom meta types with TanStack's.
 * This provides type safety and autocompletion for our custom `meta` objects.
 */
declare module '@tanstack/table-core' {
    interface TableMeta<TData extends object> extends CustomTableMeta<TData> {}
    interface ColumnMeta<TData extends object, TValue> extends CustomColumnMeta<TData, TValue> {}
    interface TableState {
        isSelectAll: boolean;
    }
}

/**
 * Extends TanStack's `ColumnDef` to include an optional `sql` property,
 * allowing a column to be defined by a raw SQL expression.
 */
export interface MosaicColumnDef<TData extends object> extends ColumnDef<TData> {
    sql?: string | SQLAst;
}

/**
 * Defines a column's LOGIC properties, explicitly omitting UI renderers (`header`, `cell`)
 * to maintain a clean separation between data logic and presentation.
 */
export type LogicColumnDef<T extends object> = Omit<MosaicColumnDef<T>, 'header' | 'cell' | 'meta'> & {
    meta?: { enableGlobalFilter?: boolean; }
};

/**
 * Defines the shape of the UI configuration for a single column, including
 * framework-agnostic placeholders for rendering components.
 */
export interface ColumnUIConfig<T extends object> {
    header?: ColumnDef<T, unknown>['header'] | any;
    cell?: ColumnDef<T, unknown>['cell'] | any;
    meta?: { Filter?: any; };
}

/**
 * Defines the top-level UI configuration object as a map from a column ID
 * to its specific UI config.
 */
export type DataTableUIConfig<T extends object> = { [columnId in string]?: ColumnUIConfig<T>; };

/**
 * Defines a contract for generating a SQL predicate from a single data row,
 * used for point-based interactions like hover and click.
 */
export interface InteractionConfig<T extends object> { createPredicate: (row: T) => SQLAst | null; }

/**
 * The complete set of options for constructing a `DataTable` instance.
 * It extends TanStack's options and adds Mosaic-specific configurations.
 */
export interface DataTableOptions<TData extends object> extends Omit<TableOptions<TData>, 'data' | 'columns' | 'state' | 'onStateChange' | 'renderFallbackValue' | 'pageCount'> {
  columns: MosaicColumnDef<TData>[];
  data?: TData[];
  initialState?: Partial<TableState>;
  filterBy?: Selection;
  internalFilter?: Selection;
  rowSelectionAs?: Selection;
  hoverAs?: Selection;
  clickAs?: Selection;
  hoverInteraction?: InteractionConfig<TData>;
  clickInteraction?: InteractionConfig<TData>;
  groupBy?: string[];
  primaryKey?: string[];
  name?: string;
  sourceTable?: string;
}

/**
 * The base configuration for the data logic of a DataTable.
 */
interface BaseDataTableLogicConfig<T extends object> {
    name: string;
    sourceTable?: string; 
    columns: LogicColumnDef<T>[];
    getBaseQuery: (filters: { where?: any; having?: any }) => Query;
    groupBy?: string[];
    hoverInteraction?: InteractionConfig<T>;
    clickInteraction?: InteractionConfig<T>;
}

/**
 * Logic configuration for a table where row selection is disabled.
 */
interface LogicConfigWithoutRowSelection<T extends object> extends BaseDataTableLogicConfig<T> {
    primaryKey?: string[];
    options?: Omit<DataTableOptions<T>, 'meta' | 'enableRowSelection'> & { enableRowSelection?: false; };
}

/**
 * Logic configuration for a table where row selection is enabled, requiring a primary key.
 */
interface LogicConfigWithRowSelection<T extends object> extends BaseDataTableLogicConfig<T> {
    primaryKey: string[];
    options: Omit<DataTableOptions<T>, 'meta' | 'enableRowSelection'> & { enableRowSelection: true; };
}

/**
 * Represents the framework-agnostic "logic" configuration for a `DataTable`.
 * It is a discriminated union to enforce that a `primaryKey` is provided
 * when `enableRowSelection` is true.
 */
export type DataTableLogicConfig<T extends object> = | LogicConfigWithoutRowSelection<T> | LogicConfigWithRowSelection<T>;

/**
 * Defines the state snapshot that the `DataTable` provides to its subscribers.
 * This object contains everything a UI framework needs to render the table.
 */
export interface DataTableSnapshot<TData extends object> {
    /** The fully-configured TanStack Table instance for UI logic and rendering. */
    table: Table<TData>;
    /** The current array of loaded data rows. */
    data: TData[];
    /** The total number of rows available on the server for the current filters. */
    totalRows: number;
    /** True if all data for the current filter has been loaded. */
    isDataLoaded: boolean;
    /** True if a query is currently in flight. */
    isFetching: boolean;
    /** True if a secondary lookup query (for filtering on aggregates) is in flight. */
    isLookupPending: boolean;
    /** An error object if the last query failed. */
    error: Error | null;
}

/** Represents the possible loading states of the data table. */
type LoadingState = 'idle' | 'fetching' | 'lookup';

enum QueryType {
    DATA = 'DATA',
    TOTAL_COUNT = 'TOTAL_COUNT',
}

/**
 * A generic, framework-agnostic class that bridges Mosaic data fetching with
 * TanStack Table state management. It acts as a headless controller for a data grid.
 */
export abstract class DataTable<TData extends object = any> extends MosaicClient {
  /** The active TanStack Table instance. Initialized once in the constructor for a stable reference. */
  protected readonly _table: Table<TData>;
  /** The column definitions for the table. */
  protected _columns: MosaicColumnDef<TData>[];
  /** The current, flat array of all loaded data rows. */
  protected _data: TData[];
  /** The complete state object for the TanStack Table instance (sorting, pagination, etc.). */
  protected _state: TableState;
  /** The original TanStack Table options, preserved for recreating the table instance. */
  protected _options: Omit<TableOptions<TData>, 'data' | 'columns' | 'state' | 'onStateChange' | 'renderFallbackValue'>;
  
  // Mosaic selection objects for various interaction types.
  protected internalFilterSelection?: Selection;
  protected rowSelectionSelection?: Selection;
  protected hoverSelection?: Selection;
  protected clickSelection?: Selection;

  /** A unique name for this client, used to source selection updates. */
  protected sourceName: string;
  /** The primary database table to query for schema metadata if not otherwise discoverable. */
  protected sourceTable?: string;
  
  // Interaction handlers for hover and click events.
  protected hoverInteraction?: InteractionConfig<TData>;
  protected clickInteraction?: InteractionConfig<TData>;

  /** An array of column IDs to perform a GROUP BY on. */
  protected groupByKeys: string[];
  /** An array of column IDs that form the unique primary key for a row. */
  protected primaryKey: string[];
  
  /** A cache for the table's column schema (names and types). */
  private _schema = new Map<string, any>();
  /** A cache for SQL predicates generated from selected row IDs. */
  private _rowSelectionPredicates = new Map<string, SQLAst | null>();
  
  /** The last error that occurred during a query. */
  public error: Error | null = null;
  
  /** A set of listener callbacks to be invoked on state changes. */
  private _listeners = new Set<() => void>();
  /** The latest state snapshot to be provided to subscribers. */
  private _snapshot: DataTableSnapshot<TData>;
  /** The current data-fetching status of the client. */
  private _loadingState: LoadingState = 'idle';

  private _chunkSize: number;
  private _offset = 0;
  private _isDataLoaded = false;
  private _totalRows = -1; // -1 indicates unknown
  private _isInitialized = false; // Guard flag
  private _initialFetchDispatched = false; // Guard flag for initial query
  private _pendingQueryOffset: number | null = null; // Stores the offset of the current in-flight DATA query
  
  private logger: Logger; // Instance of our logger for debugging.

  constructor(options: DataTableOptions<TData>) {
    super(options.filterBy);
    const { 
        columns, 
        data, 
        initialState, 
        filterBy, 
        internalFilter,
        rowSelectionAs,
        hoverAs,
        clickAs,
        hoverInteraction,
        clickInteraction,
        groupBy = [],
        primaryKey = [],
        name,
        sourceTable,
        ...rest 
    } = options;
    this._options = rest;
    
    this.sourceName = name || this.constructor.name;
    this.logger = new Logger(this.sourceName);
    this.logger.log('CONSTRUCTOR: Initializing with options:', options);

    this.sourceTable = sourceTable;
    this.internalFilterSelection = internalFilter;
    this.rowSelectionSelection = rowSelectionAs;
    this.hoverSelection = hoverAs;
    this.clickSelection = clickAs;
    this.hoverInteraction = hoverInteraction;
    this.clickInteraction = clickInteraction;
    this.groupByKeys = groupBy;
    this.primaryKey = primaryKey;

    if (this._options.enableRowSelection && (!this.primaryKey || this.primaryKey.length === 0)) {
        const errorMsg = `'enableRowSelection' is true, but a 'primaryKey' array was not provided. A primary key is required to uniquely identify rows for selection.`;
        this.logger.error(errorMsg);
        throw new Error(`[${this.sourceName}] ${errorMsg}`);
    }
    
    this._columns = columns;
    this._data = [];
    
    this._state = {
      columnFilters: [], columnOrder: [], columnPinning: { left: [], right: [] },
      columnSizing: {}, columnVisibility: {}, expanded: {}, globalFilter: undefined,
      grouping: [], 
      pagination: {
        pageIndex: 0,
        pageSize: 500,
      }, 
      rowSelection: {},
      sorting: [],
      isSelectAll: false,
      ...initialState,
    };
    this._chunkSize = this._state.pagination.pageSize;

    if (!this.hoverInteraction && this.primaryKey.length > 0) {
        this.hoverInteraction = {
            createPredicate: (row) => {
                const predicates = this.primaryKey.map(key => eq(key, literal((row as any)[key])));
                return and(...predicates);
            }
        };
    }
    if (!this.clickInteraction && this.primaryKey.length > 0) {
        this.clickInteraction = {
            createPredicate: (row) => {
                const predicates = this.primaryKey.map(key => eq(key, literal((row as any)[key])));
                return and(...predicates);
            }
        };
    }
    
    this._table = this._createTable();

    this._snapshot = {
        table: this._table,
        data: this._data,
        totalRows: 0,
        isDataLoaded: this._isDataLoaded,
        isFetching: true,
        isLookupPending: false,
        error: this.error,
    };
    this.logger.log('CONSTRUCTOR: Initialization complete.');
  }

  public fetchNextChunk() {
    if (this._loadingState !== 'idle' || this._isDataLoaded || !this._initialFetchDispatched) return;
    this.logger.log('VIRTUALIZER: Request to fetch next chunk received.');
    const query = this.query(this.filterBy?.predicate(this), { type: QueryType.DATA });
    if (query) {
        this._pendingQueryOffset = this._offset;
        this.requestQuery(query);
    }
  }

  /**
   * Connects this client to the Mosaic coordinator and sets up subscriptions.
   * @returns A cleanup function to be called on component unmount.
   */
  public connect(): () => void {
    this.logger.log('LIFECYCLE: Connecting to coordinator...');
    this._isInitialized = true;
    vg.coordinator().connect(this);
    this.initializeSelections();
    const originalDestroy = this.destroy.bind(this);
    return () => {
      originalDestroy();
    };
  }

  /**
   * Initializes or clears interaction-based selections upon connection.
   */
  public initializeSelections() {
    this.logger.log('LIFECYCLE: Initializing output selections (hover, click).');
    if (this.hoverSelection) {
        this.hoverSelection.update({ source: this.sourceName, predicate: literal(false) });
    }
    if (this.clickSelection) {
        this.clickSelection.update({ source: this.sourceName, predicate: null });
    }
  }

  /**
   * Disconnects from the coordinator and cleans up selections and listeners.
   */
  public destroy() {
    this.logger.log('LIFECYCLE: Destroying client and disconnecting from coordinator.');
    this._isInitialized = false;
    const source = this.sourceName;
    if (this.internalFilterSelection) this.internalFilterSelection.update({ source, predicate: null });
    if (this.rowSelectionSelection) this.rowSelectionSelection.update({ source, predicate: null });
    if (this.hoverSelection) this.hoverSelection.update({ source, predicate: null });
    if (this.clickSelection) this.clickSelection.update({ source, predicate: null });
    
    if (this.coordinator) {
        this.coordinator.disconnect(this);
    }

    this._listeners.clear();
  }
  
  /**
   * Part of the MosaicClient lifecycle. Generates a query to fetch schema metadata.
   */
  fields() {
    this.logger.log('MOSAIC: `fields()` called. Generating metadata query.');
    let fromTable: string | undefined = this.sourceTable;

    if (!fromTable) {
        const baseQuery = this.getBaseQuery({});
        // @ts-ignore - Fallback heuristic to introspect the base query for its source table.
        const fromClause = baseQuery.clauses.from[0];
        fromTable = fromClause?.from;
    }

    if (!fromTable || typeof fromTable !== 'string') {
        const errorMsg = `Could not determine a source table for metadata query. Please add a 'sourceTable' property to your logic config.`;
        this.logger.error(errorMsg);
        throw new Error(`[${this.sourceName}] ${errorMsg}`);
    }
    
    const baseColumns = this._columns.map(c => c.id).filter(id => id && !['select', 'rank'].includes(id));
    const query = Query.from(fromTable).select(...baseColumns);
    this.logger.log('MOSAIC: `fields()` returning query:', query.toString());
    return query;
  }

  /**
   * Part of the MosaicClient lifecycle. Receives schema info and caches it.
   */
  fieldInfo(info: { column: string, type: any }[]) {
    this.logger.log('MOSAIC: `fieldInfo()` called with schema:', info);
    this._schema.clear();
    for (const { column, type } of info) {
        this._schema.set(column, type);
    }
    this.logger.log('MOSAIC: Schema cached. Now waiting for state update to trigger query.');
  }

  /**
   * Handler for row hover events, which updates the `hoverAs` selection.
   */
  public handleRowHover = (rowObject: TData | null): void => {
    if (this.hoverSelection && this.hoverInteraction) {
      const predicate = rowObject 
        ? this.hoverInteraction.createPredicate(rowObject) 
        : literal(false);
      this.hoverSelection.update({ source: this.sourceName, predicate });
    }
  }

  /**
   * Handler for row click events, which updates the `clickAs` selection.
   */
  public handleRowClick = (rowObject: TData | null): void => {
    if (this.clickSelection && this.clickInteraction) {
      const predicate = rowObject 
        ? this.clickInteraction.createPredicate(rowObject) 
        : null;
      this.clickSelection.update({ source: this.sourceName, predicate });
    }
  }

  /**
   * A computed property to check if any column is configured for global filtering.
   */
  private get _hasGlobalFilter(): boolean {
    return this._columns.some(c => c.meta?.enableGlobalFilter);
  }

  /**
   * Creates a new, fully configured TanStack Table instance based on the current state.
   */
  private _createTable(): Table<TData> {
    const tableOptions: TableOptions<TData> = {
      ...this._options,
      meta: {
        ...(this._options.meta as object),
        onRowHover: this.handleRowHover,
        onRowClick: this.handleRowClick,
        hasGlobalFilter: this._hasGlobalFilter,
        toggleSelectAll: (value) => this.toggleSelectAll(value),
      },
      data: this._data,
      columns: this._columns,
      state: this._state,
      pageCount: this._totalRows > 0 ? Math.ceil(this._totalRows / this._state.pagination.pageSize) : -1,
      onStateChange: (updater) => this._updateState(updater),
      manualSorting: true,
      manualFiltering: true,
      manualPagination: true,
      manualGrouping: true,
      renderFallbackValue: null,
      getCoreRowModel: getCoreRowModel(),
      getSortedRowModel: getSortedRowModel(),
      getFilteredRowModel: getFilteredRowModel(),
      getPaginationRowModel: getPaginationRowModel(),
      getGroupedRowModel: getGroupedRowModel(),
      enableColumnResizing: true,
      columnResizeMode: 'onChange',
      enableMultiRowSelection: true,
    };

    if (this.primaryKey.length > 0 && !tableOptions.getRowId) {
        tableOptions.getRowId = (row: TData) => {
          if (!row) return ''; // Defensive check for undefined rows
          const keyParts = this.primaryKey.map(key => (row as any)[key]);
          return JSON.stringify(keyParts);
        };
    }
    
    return createTable<TData>(tableOptions);
  }
  
  public toggleSelectAll = (value: boolean) => {
    this.logger.log(`STATE: Toggling "Select All" to ${value}.`);
    this._updateState(old => ({
        ...old,
        isSelectAll: value,
        rowSelection: value ? old.rowSelection : {} // Clear individual selections if turning off
    }));
  };

  /**
   * The core state update handler. Called by TanStack Table whenever an action occurs.
   * It determines what changed and triggers the appropriate Mosaic-side effect.
   */
  private _updateState(updater: Updater<TableState>) {
    if (!this._isInitialized) {
        this.logger.warn('STATE: `_updateState` called before client is fully initialized. Ignoring.');
        return;
    }
    const prevState = this._state;
    const newState = typeof updater === 'function' ? updater(prevState) : updater;
    
    if (JSON.stringify(prevState) === JSON.stringify(newState)) return;

    this.logger.log('STATE: `_updateState` called. Analyzing changes.');

    const filterChanged = JSON.stringify(newState.columnFilters) !== JSON.stringify(prevState.columnFilters) || newState.globalFilter !== prevState.globalFilter;
    const sortChanged = JSON.stringify(newState.sorting) !== JSON.stringify(prevState.sorting);
    const pageChanged = newState.pagination.pageIndex !== prevState.pagination.pageIndex;
    const rowSelectionChanged = JSON.stringify(newState.rowSelection) !== JSON.stringify(prevState.rowSelection) || newState.isSelectAll !== prevState.isSelectAll;

    if (filterChanged) this.logger.log('STATE: Column/global filters changed.');
    if (sortChanged) this.logger.log('STATE: Sorting changed.');
    if (pageChanged) this.logger.log('STATE: Page index changed.');
    if (rowSelectionChanged) this.logger.log('STATE: Row selection changed.');

    if (prevState.isSelectAll && JSON.stringify(newState.rowSelection) !== JSON.stringify(prevState.rowSelection)) {
        this.logger.log('STATE: Individual row toggled while "Select All" was active. Deactivating "Select All".');
        newState.isSelectAll = false;
    }

    this._state = newState;
    this._table.setOptions(prev => ({ ...prev, state: this._state, data: this._data }));
    this._notifyListeners(); 

    if (filterChanged || sortChanged || pageChanged) {
        this.logger.log('STATE: Resetting data due to filter, sort, or page change.');
        this._data = [];
        this._offset = newState.pagination.pageIndex * newState.pagination.pageSize;
        this._isDataLoaded = false;
        
        if (!this._initialFetchDispatched || filterChanged || sortChanged || pageChanged) {
          this._initialFetchDispatched = true;
          const externalFilter = this.filterBy?.predicate(this);

          const dataQuery = this.query(externalFilter, { type: QueryType.DATA });
          if (dataQuery) {
            this._pendingQueryOffset = this._offset;
            this.requestQuery(dataQuery);
          }

          if (filterChanged || sortChanged) {
              this._totalRows = -1; // Reset total rows since filters/sorts change it
              const countQuery = this.query(externalFilter, { type: QueryType.TOTAL_COUNT });
              if (countQuery) this.requestQuery(countQuery);
          }
        }
    }
    
    if (filterChanged) {
        this._handleInternalFilterChange();
    }

    if (rowSelectionChanged) {
        this._handleRowSelectionChange();
    }
  }

  /**
   * Translates changes in TanStack's row selection state into an `OR`'d SQL
   * predicate and updates the `rowSelectionAs` Mosaic Selection.
   */
  private _handleRowSelectionChange() {
    if (!this.rowSelectionSelection) return;
    this.logger.log('MOSAIC: Handling row selection change. `isSelectAll` is', this.state.isSelectAll);

    if (this.state.isSelectAll) {
        const deselectedKeys = Object.keys(this.state.rowSelection).filter(key => !this.state.rowSelection[key]);
        if (deselectedKeys.length > 0) {
            const deselectedPredicates = deselectedKeys.map(id => this.createPredicateFromRowId(id)).filter((p): p is SQLAst => p !== null);
            const finalPredicate = not(or(...deselectedPredicates));
            this.logger.log('MOSAIC: Broadcasting "Select All" with exceptions predicate.');
            this.rowSelectionSelection.update({ source: `${this.sourceName}_row_selection`, predicate: finalPredicate });
        } else {
            this.logger.log('MOSAIC: Broadcasting "Select All" (WHERE TRUE) predicate.');
            this.rowSelectionSelection.update({ source: `${this.sourceName}_row_selection`, predicate: null }); // WHERE TRUE
        }
        return;
    }

    const selectedKeys = Object.keys(this.state.rowSelection).filter(key => this.state.rowSelection[key]);
    
    const newPredicateCache = new Map<string, SQLAst | null>();
    for (const id of selectedKeys) {
        let predicate = this._rowSelectionPredicates.get(id);
        if (!predicate) {
            predicate = this.createPredicateFromRowId(id);
        }
        newPredicateCache.set(id, predicate);
    }
    this._rowSelectionPredicates = newPredicateCache;

    const activePredicates = Array.from(this._rowSelectionPredicates.values()).filter((p): p is SQLAst => p !== null);
    const finalPredicate = activePredicates.length > 0 ? or(...activePredicates) : null;
    this.logger.log('MOSAIC: Broadcasting individual row selection predicate. Total selected:', activePredicates.length);
    this.rowSelectionSelection.update({ source: `${this.sourceName}_row_selection`, predicate: finalPredicate });
  }

  /**
   * Generates SQL predicates from the current TanStack filter state (`columnFilters`
   * and `globalFilter`), correctly separating them into `WHERE` and `HAVING` clauses
   * if the query is grouped.
   */
  private _generateFilterPredicates(state: TableState): { where: SQLAst[], having: SQLAst[] } {
    const createPredicate = (id: string, value: any) => sql`CAST(${id} AS VARCHAR) ILIKE ${literal(`%${value}%`)}`;
    if (this.groupByKeys.length === 0) {
        const where: SQLAst[] = [];
        for (const f of state.columnFilters) if (f.value != null && f.value !== '') where.push(createPredicate(f.id, f.value));
        if (state.globalFilter) {
            const searchableColumns = this._columns.filter(c => c.meta?.enableGlobalFilter);
            const globalPredicates = searchableColumns.map(c => createPredicate(c.id!, state.globalFilter));
            if (globalPredicates.length > 0) where.push(or(...globalPredicates));
        }
        return { where, having: [] };
    }
    const where: SQLAst[] = [];
    const having: SQLAst[] = [];
    for (const f of state.columnFilters) {
        if (f.value != null && f.value !== '') {
            const predicate = createPredicate(f.id, f.value);
            if (this.groupByKeys.includes(f.id)) where.push(predicate);
            else having.push(predicate);
        }
    }
    if (state.globalFilter) {
        const searchableColumns = this._columns.filter(c => c.meta?.enableGlobalFilter);
        const globalWherePredicates: SQLAst[] = [], globalHavingPredicates: SQLAst[] = [];
        searchableColumns.forEach(c => {
            const predicate = createPredicate(c.id!, state.globalFilter);
            if (this.groupByKeys.includes(c.id!)) globalWherePredicates.push(predicate);
            else globalHavingPredicates.push(predicate);
        });
        if (globalWherePredicates.length > 0) where.push(or(...globalWherePredicates));
        if (globalHavingPredicates.length > 0) having.push(or(...globalHavingPredicates));
    }
    return { where, having };
  }

  /**
   * Handles changes to the internal filter state, potentially performing a "reverse lookup"
   * query if filtering is needed on an aggregated column. Updates the `internalFilterAs` selection.
   */
  private async _handleInternalFilterChange() {
    if (!this.internalFilterSelection) return;
    this.logger.log('MOSAIC: Handling internal filter change.');

    const { where, having } = this._generateFilterPredicates(this._state);
    let finalPredicate: SQLAst | null = null;
    if (having.length > 0) {
        this.logger.log('MOSAIC: Detected HAVING clause filter. Performing reverse lookup query.');
        this._loadingState = 'lookup';
        this._notifyListeners();
        try {
            const externalPredicate = this.filterBy?.predicate(this);
            const lookupQuery = this.getBaseQuery({ where: externalPredicate, having: having }).select(this.groupByKeys);
            const result = await this.coordinator.query(lookupQuery);
            const validKeys = result.toArray().map((row: any) => ({...row}));
            if (validKeys.length > 0) {
                const keyPredicates = validKeys.map(keyRow => {
                    const keyParts = this.groupByKeys.map(key => eq(key, literal(keyRow[key])));
                    return and(...keyParts);
                });
                const reverseLookupPredicate = or(...keyPredicates);
                finalPredicate = and(...where, reverseLookupPredicate);
            } else {
                finalPredicate = sql`FALSE`;
            }
        } catch (err) {
            this.queryError(err as Error);
            return;
        } finally {
            if (this._loadingState === 'lookup') this._loadingState = 'idle';
        }
    } else {
        finalPredicate = and(...where);
    }
    this.logger.log('MOSAIC: Broadcasting internal filter predicate.');
    this.internalFilterSelection.update({ source: `${this.sourceName}_internal_filters`, predicate: finalPredicate });
  }
  
  /**
   * Creates a SQL predicate to uniquely identify a row based on its ID,
   * which is a JSON string of its primary key values.
   */
  public createPredicateFromRowId(id: string): SQLAst | null {
    if (this.primaryKey.length === 0) {
      this.logger.warn('Cannot create predicate from row ID: No primaryKey is defined for this table.');
      return null;
    }
    try {
      const keyValues = JSON.parse(id);
      if (!Array.isArray(keyValues) || keyValues.length !== this.primaryKey.length) {
        this.logger.error('Mismatched row ID format. Expected an array with length', this.primaryKey.length);
        return null;
      }
      const keyPredicates = this.primaryKey.map((key, i) => eq(key, literal(keyValues[i])));
      return and(...keyPredicates);
    } catch (e) {
      this.logger.error('Failed to parse row ID.', id, e);
      return null;
    }
  }

  /**
   * Part of the MosaicClient interface, indicates if filter changes affect the query's grouping.
   */
  get filterStable(): boolean { return false; }

  /**
   * Part of the MosaicClient interface. Builds the final SQL query to be executed,
   * combining the external filter with the internal TanStack state (sorting, pagination).
   */
  public query(externalFilter?: FilterExpr, options?: { type?: QueryType }): Query | null {
    const queryType = options?.type;
    this.logger.log(`MOSAIC: \`query()\` called. Type: ${queryType || 'DATA'}, External Filter:`, externalFilter);
    
    const internalFilters = this._generateFilterPredicates(this.state);
    const combinedWhere = and(externalFilter, ...internalFilters.where);
    const baseQuery = this.getBaseQuery({ where: combinedWhere, having: internalFilters.having });

    if (queryType === QueryType.TOTAL_COUNT) {
        if (!baseQuery.clauses) {
            this.logger.error('Cannot build count query: base query is not properly initialized.');
            return null;
        }
        const countQuery = new Query().from(baseQuery.clauses.from).where(baseQuery.clauses.where);
        return countQuery.select({ total_rows: vg.count() });
    }

    const { sorting } = this.state;
    const order = sorting.map(s => (s.desc ? desc(s.id) : asc(s.id)));

    const finalQuery = baseQuery
      .orderby(order)
      .limit(this._chunkSize)
      .offset(this._offset);
      
    this.logger.log('MOSAIC: `query()` returning SQL:', finalQuery.toString());
    return finalQuery;
  }

  /**
   * An abstract method that must be implemented by a concrete subclass.
   * It defines the core SELECT and FROM clauses of the table's query.
   */
  public abstract getBaseQuery(filters: { where?: any, having?: any }): Query;

  /**
   * Part of the MosaicClient lifecycle. Called by the Coordinator with the query result.
   */
  queryResult(data: ArrowTable, query?: any): this {
    const queryType = this._pendingQueryOffset !== null ? QueryType.DATA : QueryType.TOTAL_COUNT;
    const queryOffset = this._pendingQueryOffset;
    this._pendingQueryOffset = null;
    
    this.logger.log(`MOSAIC: \`queryResult()\` received ${data.numRows} rows for a ${queryType} query.`);
    this._loadingState = 'idle';
    this.error = null;

    if (queryType === QueryType.TOTAL_COUNT) {
        const total = data.get(0)?.total_rows;
        if (typeof total === 'number' && this._totalRows !== total) {
            this.logger.log(`MOSAIC: Total row count updated from ${this._totalRows} to ${total}.`);
            this._totalRows = total;
            this._table.setOptions(prev => ({
                ...prev,
                pageCount: Math.ceil(this._totalRows / this._state.pagination.pageSize),
            }));
            this._notifyListeners();
        }
        return this;
    }
    
    const newRows = data.toArray().map(row => ({ ...row })) as TData[];
    
    const pageBaseOffset = this._state.pagination.pageIndex * this._state.pagination.pageSize;
    const expectedOffsetForAppend = pageBaseOffset + this._data.length;

    if (queryOffset === expectedOffsetForAppend) {
        this.logger.log(`Received data for offset ${queryOffset}. Performing an APPEND.`);
        this._data = this._data.concat(newRows);
    } else {
        this.logger.log(`Received data for offset ${queryOffset}, which does not match expected append offset ${expectedOffsetForAppend}. Performing a RESET.`);
        this._data = newRows;
    }
    
    this._offset = pageBaseOffset + this._data.length;

    if (newRows.length < this._chunkSize) {
        this.logger.log('MOSAIC: End of data detected for current view.');
        this._isDataLoaded = true;
    }
    
    this._table.setOptions(prev => ({ ...prev, data: this._data }));
    this._notifyListeners();
    return this;
  }

  /**
   * Part of the MosaicClient lifecycle. Called when a query is pending.
   */
  queryPending(): this {
    this.logger.log('MOSAIC: `queryPending()` called. Setting state to fetching.');
    this._loadingState = 'fetching';
    this.error = null;
    this._notifyListeners();
    return this;
  }
  
  /**
   * Part of the MosaicClient lifecycle. Called when a query fails.
   */
  queryError(error: Error): this {
    this.logger.error('MOSAIC: `queryError()` called.', error);
    this._loadingState = 'idle';
    this.error = error;
    this._notifyListeners();
    return this;
  }

  /**
   * Subscribes a listener function to be called on any state change.
   * @returns An unsubscribe function.
   */
  public subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  /**
   * Returns the latest state snapshot. Required for `useSyncExternalStore`.
   */
  public getSnapshot = (): DataTableSnapshot<TData> => this._snapshot;

  /**
   * Assembles a new state snapshot and notifies all subscribed listeners.
   */
  private _notifyListeners = () => {
    this._snapshot = {
        table: this._table,
        data: this._data,
        totalRows: this._totalRows,
        isDataLoaded: this._isDataLoaded,
        isFetching: this._loadingState === 'fetching',
        isLookupPending: this._loadingState === 'lookup',
        error: this.error,
    };
    this._listeners.forEach(listener => listener());
  }
  
  /** Public getter for the current TanStack Table instance. */
  public get table(): Table<TData> { return this._table; }
  /** Public getter for the current TanStack Table state. */
  public get state(): TableState { return this._state; }
}