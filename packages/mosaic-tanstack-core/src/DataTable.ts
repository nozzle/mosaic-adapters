// This file defines the framework-agnostic `DataTable` base class, the core of the Mosaic-Tanstack adapter.
// It acts as a bridge, extending MosaicClient to handle data fetching and implementing a subscription model
// to push state updates to any UI framework.
import { MosaicClient, Selection, type FilterExpr } from '@uwdata/mosaic-core';
import { literal, isIn, and, sql, or, Query, desc, asc, eq, type SQLAst } from '@uwdata/mosaic-sql';
import * as vg from '@uwdata/vgplot';
import {
    createTable,
    getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel, getGroupedRowModel,
    type Table, type TableOptions, type ColumnDef, type TableState, type Updater, type Column
} from '@tanstack/table-core';
import type { ComponentType } from 'svelte';

// --- TYPE DEFINITIONS ---
// This section defines a strict contract for configuring a DataTable, enforcing a clean
// separation between data/logic configuration (`DataTableLogicConfig`) and framework-specific
// rendering configuration (`DataTableUIConfig`). Module augmentation is used to add custom
// properties to Tanstack's core types for better type safety and autocompletion.

export interface CustomTableMeta<TData extends object> {
    onRowHover?: (row: TData | null) => void;
    onRowClick?: (row: TData | null) => void;
    hasGlobalFilter?: boolean;
}

export interface CustomColumnMeta<TData extends object, TValue> {
    Filter?: ComponentType<{ column: Column<TData, TValue> }>;
    enableGlobalFilter?: boolean;
}

declare module '@tanstack/table-core' {
    interface TableMeta<TData extends object> extends CustomTableMeta<TData> {}
    interface ColumnMeta<TData extends object, TValue> extends CustomColumnMeta<TData, TValue> {}
}

export interface MosaicColumnDef<TData extends object> extends ColumnDef<TData> {
    sql?: string | SQLAst;
}

// A column's framework-agnostic logic definition, omitting UI renderers.
export type LogicColumnDef<T extends object> = Omit<MosaicColumnDef<T>, 'header' | 'cell' | 'meta'> & {
    meta?: { enableGlobalFilter?: boolean; }
};

// A column's framework-specific UI definition, containing renderers.
export interface ColumnUIConfig<T extends object> {
    header?: ColumnDef<T, unknown>['header'] | ComponentType;
    cell?: ColumnDef<T, unknown>['cell'] | ComponentType;
    meta?: { Filter?: ComponentType<{ column: any }>; };
}

// A map of column IDs to their specific UI configurations.
export type DataTableUIConfig<T extends object> = { [columnId in string]?: ColumnUIConfig<T>; };

// Defines how to create a SQL predicate from a single data row for interactions.
export interface InteractionConfig<T extends object> { createPredicate: (row: T) => SQLAst | null; }

// The complete, framework-agnostic configuration for a DataTable's logic.
export interface DataTableOptions<TData extends object> extends Omit<TableOptions<TData>, 'data' | 'columns' | 'state' | 'onStateChange' | 'renderFallbackValue'> {
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

interface BaseDataTableLogicConfig<T extends object> {
    name: string;
    sourceTable?: string;
    columns: LogicColumnDef<T>[];
    getBaseQuery: (filters: { where?: any; having?: any }) => Query;
    groupBy?: string[];
    hoverInteraction?: InteractionConfig<T>;
    clickInteraction?: InteractionConfig<T>;
}

interface LogicConfigWithoutRowSelection<T extends object> extends BaseDataTableLogicConfig<T> {
    primaryKey?: string[];
    options?: Omit<DataTableOptions<T>, 'meta' | 'enableRowSelection'> & { enableRowSelection?: false; };
}

interface LogicConfigWithRowSelection<T extends object> extends BaseDataTableLogicConfig<T> {
    primaryKey: string[];
    options: Omit<DataTableOptions<T>, 'meta' | 'enableRowSelection'> & { enableRowSelection: true; };
}

export type DataTableLogicConfig<T extends object> = | LogicConfigWithoutRowSelection<T> | LogicConfigWithRowSelection<T>;

// --- END TYPES ---


// The data shape provided to UI subscribers.
export interface DataTableSnapshot<TData extends object> {
    table: Table<TData>;
    isLoading: boolean;
    isFetching: boolean;
    isLookupPending: boolean; // True during the "reverse lookup" for HAVING clauses.
    error: Error | null;
}

// Internal state machine for tracking data fetching status.
type LoadingState = 'idle' | 'fetching' | 'lookup';

/**
 * A framework-agnostic class that serves as the "brain" for a data table.
 * It has a dual identity:
 * 1. As a MosaicClient, it fetches data by generating SQL queries.
 * 2. As a Tanstack Table controller, it manages UI state (sorting, filtering, pagination).
 * It translates Tanstack state into SQL queries and pushes results back to the UI
 * via a subscription model.
 */
export abstract class DataTable<TData extends object = any> extends MosaicClient {
  // Tanstack Table state and instance
  protected _table: Table<TData>;
  protected _state: TableState;
  protected _data: TData[];

  // Configuration stores
  protected _columns: MosaicColumnDef<TData>[];
  protected _options: Omit<TableOptions<TData>, 'data' | 'columns' | 'state' | 'onStateChange' | 'renderFallbackValue'>;

  // Mosaic selection outputs
  protected internalFilterSelection?: Selection;
  protected rowSelectionSelection?: Selection;
  protected hoverSelection?: Selection;
  protected clickSelection?: Selection;

  // Configuration for interactions and identity
  protected sourceName: string;
  protected sourceTable?: string;
  protected hoverInteraction?: InteractionConfig<TData>;
  protected clickInteraction?: InteractionConfig<TData>;
  protected groupByKeys: string[];
  protected primaryKey: string[];

  // Internal state
  private _schema = new Map<string, any>();
  private _rowSelectionPredicates = new Map<string, SQLAst | null>(); // Cache for row selection predicates
  public error: Error | null = null;

  // Subscription model for UI updates
  private _listeners = new Set<() => void>();
  private _snapshot: DataTableSnapshot<TData>;
  private _loadingState: LoadingState = 'idle';

  constructor(options: DataTableOptions<TData>) {
    super(options.filterBy);
    const {
        columns, data, initialState, filterBy, internalFilter,
        rowSelectionAs, hoverAs, clickAs, hoverInteraction,
        clickInteraction, groupBy = [], primaryKey = [],
        name, sourceTable, ...rest
    } = options;

    this._options = rest;
    this.sourceTable = sourceTable;
    this.internalFilterSelection = internalFilter;
    this.rowSelectionSelection = rowSelectionAs;
    this.hoverSelection = hoverAs;
    this.clickSelection = clickAs;
    this.hoverInteraction = hoverInteraction;
    this.clickInteraction = clickInteraction;
    this.sourceName = name || this.constructor.name;
    this.groupByKeys = groupBy;
    this.primaryKey = primaryKey;

    // A guard rail to enforce that row selection requires a way to identify rows.
    if (this._options.enableRowSelection && (!this.primaryKey || this.primaryKey.length === 0)) {
        throw new Error(`[Mosaic-Tanstack] Error in table "${this.sourceName}": 'enableRowSelection' requires a 'primaryKey' to be defined in the logic configuration.`);
    }

    this._columns = columns;
    this._data = data || [];

    // Initialize the Tanstack state object. This is our single source of truth for the UI.
    this._state = {
      columnFilters: [], columnOrder: [], columnPinning: { left: [], right: [] },
      columnSizing: {}, columnVisibility: {}, expanded: {}, globalFilter: undefined,
      grouping: [], pagination: { pageIndex: 0, pageSize: 10 }, rowSelection: {},
      sorting: [],
      ...initialState,
    };

    // Provide default hover/click interaction logic if a primary key is available.
    if (!this.hoverInteraction && this.primaryKey.length > 0) {
        this.hoverInteraction = {
            createPredicate: (row) => and(...this.primaryKey.map(key => eq(key, literal((row as any)[key])))),
        };
    }
    if (!this.clickInteraction && this.primaryKey.length > 0) {
        this.clickInteraction = {
            createPredicate: (row) => and(...this.primaryKey.map(key => eq(key, literal((row as any)[key])))),
        };
    }

    // Create the initial Tanstack Table instance.
    this._table = this._createTable();

    // Create the initial snapshot for subscribers.
    this._snapshot = {
        table: this._table,
        isLoading: true,
        isFetching: true,
        isLookupPending: false,
        error: this.error,
    };
  }

  /** Connects the DataTable to the Mosaic coordinator and returns a cleanup function. */
  public connect(): () => void {
    vg.coordinator().connect(this);
    this.initializeSelections();
    return this.destroy.bind(this);
  }

  /** Clears any persistent selections when the table is first connected. */
  public initializeSelections() {
    if (this.hoverSelection) this.hoverSelection.update({ source: this.sourceName, predicate: literal(false) });
    if (this.clickSelection) this.clickSelection.update({ source: this.sourceName, predicate: null });
  }

  /** Disconnects from the coordinator and cleans up selections to prevent memory leaks. */
  public destroy() {
    const source = this.sourceName;
    if (this.internalFilterSelection) this.internalFilterSelection.update({ source, predicate: null });
    if (this.rowSelectionSelection) this.rowSelectionSelection.update({ source, predicate: null });
    if (this.hoverSelection) this.hoverSelection.update({ source, predicate: null });
    if (this.clickSelection) this.clickSelection.update({ source, predicate: null });

    if (this.coordinator) this.coordinator.disconnect(this);
    this._listeners.clear();
  }

  /** (Mosaic Lifecycle) Declares the columns needed for metadata fetching. */
  fields() {
    let fromTable: string | undefined = this.sourceTable;

    // Heuristic to infer the source table from the base query if not explicitly provided.
    if (!fromTable) {
        const baseQuery = this.getBaseQuery({});
        // @ts-ignore
        const fromClause = baseQuery.clauses.from[0];
        fromTable = fromClause?.from;
    }

    if (!fromTable || typeof fromTable !== 'string') {
        throw new Error(`Could not determine a source table for metadata query in ${this.sourceName}. Please add a 'sourceTable' property to your logic config.`);
    }

    const baseColumns = this._columns.map(c => c.id).filter(id => id && !['select', 'rank'].includes(id as string));
    return Query.from(fromTable).select(...baseColumns);
  }

  /** (Mosaic Lifecycle) Receives column type info from Mosaic and triggers the initial data fetch. */
  fieldInfo(info: { column: string, type: any }[]) {
    this._schema.clear();
    for (const { column, type } of info) {
        this._schema.set(column, type);
    }
    this.requestQuery();
  }

  /** Creates a predicate for the hovered row and updates the hover selection. */
  public handleRowHover = (rowObject: TData | null): void => {
    if (this.hoverSelection && this.hoverInteraction) {
      const predicate = rowObject ? this.hoverInteraction.createPredicate(rowObject) : literal(false);
      this.hoverSelection.update({ source: this.sourceName, predicate });
    }
  }

  /** Creates a predicate for the clicked row and updates the click selection. */
  public handleRowClick = (rowObject: TData | null): void => {
    if (this.clickSelection && this.clickInteraction) {
      const predicate = rowObject ? this.clickInteraction.createPredicate(rowObject) : null;
      this.clickSelection.update({ source: this.sourceName, predicate });
    }
  }

  /** Determines if the table has a global filter input. */
  private get _hasGlobalFilter(): boolean {
    return this._columns.some(c => c.meta?.enableGlobalFilter);
  }

  /** Configures and creates a new Tanstack Table instance. */
  private _createTable(): Table<TData> {
    const tableOptions: TableOptions<TData> = {
      ...this._options,
      meta: {
        ...(this._options.meta as object),
        onRowHover: this.handleRowHover,
        onRowClick: this.handleRowClick,
        hasGlobalFilter: this._hasGlobalFilter,
      },
      data: this._data,
      columns: this._columns,
      state: this._state,
      onStateChange: (updater) => this._updateState(updater),
      // --- CRITICAL: Set all data operations to manual ---
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
    };

    // Automatically generate a stable row ID if a primary key is defined.
    if (this.primaryKey.length > 0 && !tableOptions.getRowId) {
        tableOptions.getRowId = (row: TData) => JSON.stringify(this.primaryKey.map(key => (row as any)[key]));
    }

    return createTable<TData>(tableOptions);
  }

  /**
   * The heart of the adapter's control loop. Called by Tanstack when the UI state should change.
   * It detects what changed (sort, filter, etc.) and triggers the appropriate action.
   */
  private _updateState(updater: Updater<TableState>) {
    const prevState = this._state;
    const newState = typeof updater === 'function' ? updater(prevState) : updater;

    if (JSON.stringify(prevState) === JSON.stringify(newState)) return;

    // Detect what specific part of the state has changed.
    const filterChanged = JSON.stringify(newState.columnFilters) !== JSON.stringify(prevState.columnFilters) || newState.globalFilter !== prevState.globalFilter;
    const sortChanged = JSON.stringify(newState.sorting) !== JSON.stringify(prevState.sorting);
    const paginationChanged = JSON.stringify(newState.pagination) !== JSON.stringify(prevState.pagination);
    const rowSelectionChanged = JSON.stringify(newState.rowSelection) !== JSON.stringify(prevState.rowSelection);

    // If filters change, reset to the first page.
    if (filterChanged && newState.pagination.pageIndex !== 0) {
        newState.pagination = { ...newState.pagination, pageIndex: 0 };
    }

    // Update internal state, recreate the table instance, and notify the UI.
    this._state = newState;
    this._table = this._createTable();
    this._notifyListeners();

    // Trigger the appropriate data-fetching or selection-updating logic.
    if (filterChanged) {
        this._handleInternalFilterChange(); // Update internal filter selection.
        this.requestQuery(); // Fetch new data.
    } else if (sortChanged || paginationChanged) {
        this.requestQuery(); // Fetch new data with different sorting/paging.
    }

    if (rowSelectionChanged) {
        this._handleRowSelectionChange(newState, prevState); // Update row selection.
    }
  }

  /** Syncs the Tanstack row selection state to the corresponding Mosaic selection. */
  private _handleRowSelectionChange(newState: TableState, prevState: TableState) {
    if (!this.rowSelectionSelection) return;

    const newKeys = new Set(Object.keys(newState.rowSelection));
    const oldKeys = new Set(Object.keys(prevState.rowSelection));

    // No-op if selection hasn't meaningfully changed.
    if (newKeys.size === oldKeys.size && [...newKeys].every(key => oldKeys.has(key))) return;

    // Update the cache of predicates for selected rows.
    for (const id of newKeys) {
        if (!oldKeys.has(id) && !this._rowSelectionPredicates.has(id)) {
            const predicate = this.createPredicateFromRowId(id);
            this._rowSelectionPredicates.set(id, predicate);
        }
    }
    for (const id of oldKeys) {
        if (!newKeys.has(id)) this._rowSelectionPredicates.delete(id);
    }
    if (newKeys.size === 0) this._rowSelectionPredicates.clear();

    // Create a single OR predicate from all active selections and update Mosaic.
    const activePredicates = Array.from(this._rowSelectionPredicates.values()).filter((p): p is SQLAst => p !== null);
    const finalPredicate = activePredicates.length > 0 ? or(...activePredicates) : null;
    this.rowSelectionSelection.update({ source: `${this.sourceName}_row_selection`, predicate: finalPredicate });
  }

  /** Translates Tanstack's filter state into `WHERE` and `HAVING` SQL predicates. */
  private _generateFilterPredicates(state: TableState): { where: SQLAst[], having: SQLAst[] } {
    const createPredicate = (id: string, value: any) => sql`CAST(${id} AS VARCHAR) ILIKE ${literal(`%${value}%`)}`;

    const where: SQLAst[] = [];
    const having: SQLAst[] = [];

    // Distribute column filters into WHERE (pre-aggregation) or HAVING (post-aggregation).
    for (const f of state.columnFilters) {
        if (f.value != null && f.value !== '') {
            const predicate = createPredicate(f.id, f.value);
            if (this.groupByKeys.includes(f.id)) where.push(predicate); else having.push(predicate);
        }
    }

    // Distribute global filter similarly.
    if (state.globalFilter) {
        const searchableColumns = this._columns.filter(c => c.meta?.enableGlobalFilter);
        const globalWhere: SQLAst[] = [], globalHaving: SQLAst[] = [];
        searchableColumns.forEach(c => {
            const predicate = createPredicate(c.id!, state.globalFilter);
            if (this.groupByKeys.includes(c.id!)) globalWhere.push(predicate); else globalHaving.push(predicate);
        });
        if (globalWhere.length > 0) where.push(or(...globalWhere));
        if (globalHaving.length > 0) having.push(or(...globalHaving));
    }
    return { where, having };
  }

  /** Updates the internal filter selection, handling the complex "reverse lookup" for HAVING clauses. */
  private async _handleInternalFilterChange() {
    if (!this.internalFilterSelection) return;

    const { where, having } = this._generateFilterPredicates(this._state);
    let finalPredicate: SQLAst | null = null;

    if (having.length > 0) {
      // --- The "Reverse Lookup" Pattern for HAVING Clauses ---
      // Problem: A HAVING clause filters aggregated data, but Mosaic needs a WHERE clause to
      // filter raw data for other linked components.
      // Solution:
      // 1. Run a preliminary query with the HAVING clause to find which groups match.
      // 2. Build a `WHERE group_key IN (...)` predicate from those results.
      // 3. Broadcast this new WHERE predicate to the rest of the application.
      this._loadingState = 'lookup';
      this._notifyListeners();
      try {
          const externalPredicate = this.filterBy?.predicate(this);
          const lookupQuery = this.getBaseQuery({ where: externalPredicate, having: having }).select(this.groupByKeys);
          const result = await this.coordinator.query(lookupQuery);
          const validKeys = result.toArray().map((row: any) => ({...row}));

          if (validKeys.length > 0) {
              const keyPredicates = validKeys.map(keyRow => and(...this.groupByKeys.map(key => eq(key, literal(keyRow[key])))));
              finalPredicate = and(...where, or(...keyPredicates));
          } else {
              // If no groups match, create a predicate that returns no results.
              finalPredicate = sql`FALSE`;
          }
      } catch (err) {
          this.queryError(err as Error);
          return;
      } finally {
          if (this._loadingState === 'lookup') this._loadingState = 'idle';
      }
    } else {
        // If there's no HAVING clause, the predicate is just the WHERE clauses.
        finalPredicate = and(...where);
    }
    this.internalFilterSelection.update({ source: `${this.sourceName}_internal_filters`, predicate: finalPredicate });
  }

  /** Utility to convert a Tanstack row ID string back into a SQL predicate. */
  public createPredicateFromRowId(id: string): SQLAst | null {
    if (this.primaryKey.length === 0) return null;
    try {
      const keyValues = JSON.parse(id);
      if (!Array.isArray(keyValues) || keyValues.length !== this.primaryKey.length) return null;
      return and(...this.primaryKey.map((key, i) => eq(key, literal(keyValues[i]))));
    } catch (e) {
      console.error('Failed to parse row ID.', id, e);
      return null;
    }
  }

  get filterStable(): boolean { return false; }

  /** (Mosaic Lifecycle) Assembles and returns the final SQL query for the current state. */
  public query(externalFilter?: FilterExpr): Query {
    const internalFilters = this._generateFilterPredicates(this.state);
    const combinedWhere = and(externalFilter, ...internalFilters.where);
    const baseQuery = this.getBaseQuery({
        where: combinedWhere,
        having: internalFilters.having
    });

    const { sorting, pagination } = this.state;
    const baseQueryAlias = `${this.sourceName}_base`;
    const order = sorting.map(s => (s.desc ? desc(s.id) : asc(s.id)));

    // Decorate the base query with sorting, pagination, and a total row count.
    const finalQuery = Query.with({ [baseQueryAlias]: baseQuery })
      .from(baseQueryAlias)
      .select('*', { total_rows: vg.count().window() })
      .orderby(order)
      .limit(pagination.pageSize)
      .offset(pagination.pageIndex * pagination.pageSize);

    return finalQuery;
  }

  /** Abstract method to be implemented by subclasses, defining the core of the table's query. */
  public abstract getBaseQuery(filters: { where?: any, having?: any }): Query;

  /** (Mosaic Lifecycle) Called when new data arrives from the coordinator. */
  queryResult(data: any): this {
    this._loadingState = 'idle';
    this.error = null;
    const rows: TData[] = (data && typeof data.toArray === 'function') ? data.toArray().map((row: object) => ({ ...row })) : [];
    this._data = rows;
    const rowCount = rows.length > 0 ? (rows[0] as any).total_rows : 0;

    // Recreate the table instance with the new data and update the total row count.
    this._table = this._createTable();
    this._table.setOptions(prev => ({ ...prev, rowCount }));
    this._notifyListeners();
    return this;
  }

  /** (Mosaic Lifecycle) Called when a query is pending. */
  queryPending(): this {
    this._loadingState = 'fetching';
    this.error = null;
    this._notifyListeners();
    return this;
  }

  /** (Mosaic Lifecycle) Called when a query fails. */
  queryError(error: Error): this {
    this._loadingState = 'idle';
    this.error = error;
    this._notifyListeners();
    return this;
  }

  // --- Subscription Model Implementation ---
  public subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  public getSnapshot = (): DataTableSnapshot<TData> => this._snapshot;

  private _notifyListeners = () => {
    this._snapshot = {
        table: this._table,
        isLoading: this._loadingState !== 'idle' && this._data.length === 0,
        isFetching: this._loadingState === 'fetching',
        isLookupPending: this._loadingState === 'lookup',
        error: this.error,
    };
    this._listeners.forEach(listener => listener());
  }

  // --- Public Getters ---
  public get table(): Table<TData> { return this._table; }
  public get state(): TableState { return this._state; }
}