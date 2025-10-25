// This file defines the generic `DataTable` base class AND all its related type definitions.
// It acts as a framework-agnostic bridge, extending MosaicClient to handle data fetching and
// implementing a subscription model to push state updates to any UI framework.
import { MosaicClient, Selection, type FilterExpr } from '@uwdata/mosaic-core';
import { literal, isIn, and, sql, or, Query, desc, asc, eq, type SQLAst } from '@uwdata/mosaic-sql';
import * as vg from '@uwdata/vgplot';
import { 
    createTable, 
    getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel, getGroupedRowModel,
    type Table, type TableOptions, type ColumnDef, type TableState, type Updater, type Column
} from '@tanstack/table-core';
import type { ComponentType } from 'svelte';

// --- MERGED TYPES FROM "tables/types.ts" ---

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

export type LogicColumnDef<T extends object> = Omit<MosaicColumnDef<T>, 'header' | 'cell' | 'meta'> & {
    meta?: { enableGlobalFilter?: boolean; }
};

export interface ColumnUIConfig<T extends object> {
    header?: ColumnDef<T, unknown>['header'] | ComponentType;
    cell?: ColumnDef<T, unknown>['cell'] | ComponentType;
    meta?: { Filter?: ComponentType<{ column: any }>; };
}

export type DataTableUIConfig<T extends object> = { [columnId in string]?: ColumnUIConfig<T>; };

export interface InteractionConfig<T extends object> { createPredicate: (row: T) => SQLAst | null; }

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

// --- END MERGED TYPES ---


export interface DataTableSnapshot<TData extends object> {
    table: Table<TData>;
    isLoading: boolean;
    isFetching: boolean;
    isLookupPending: boolean;
    error: Error | null;
}

type LoadingState = 'idle' | 'fetching' | 'lookup';

export abstract class DataTable<TData extends object = any> extends MosaicClient {
  protected _table: Table<TData>;
  protected _columns: MosaicColumnDef<TData>[];
  protected _data: TData[];
  protected _state: TableState;
  protected _options: Omit<TableOptions<TData>, 'data' | 'columns' | 'state' | 'onStateChange' | 'renderFallbackValue'>;
  
  protected internalFilterSelection?: Selection;
  protected rowSelectionSelection?: Selection;
  protected hoverSelection?: Selection;
  protected clickSelection?: Selection;
  protected sourceName: string;
  protected sourceTable?: string;

  protected hoverInteraction?: InteractionConfig<TData>;
  protected clickInteraction?: InteractionConfig<TData>;

  protected groupByKeys: string[];
  protected primaryKey: string[];
  
  private _schema = new Map<string, any>();
  private _rowSelectionPredicates = new Map<string, SQLAst | null>();
  
  public error: Error | null = null;
  
  private _listeners = new Set<() => void>();
  private _snapshot: DataTableSnapshot<TData>;
  private _loadingState: LoadingState = 'idle';

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

    if (this._options.enableRowSelection && (!this.primaryKey || this.primaryKey.length === 0)) {
        const tableName = name || this.constructor.name;
        throw new Error(
            `[Mosaic-Tanstack Adapter Error in table "${tableName}"]\n` +
            `'enableRowSelection' is true, but a 'primaryKey' array was not provided in the logic configuration.\n` +
            `A primary key is required to uniquely identify rows for selection.\n` +
            `Please add a 'primaryKey' property (e.g., primaryKey: ['id']) to your DataTableLogicConfig.`
        );
    }
    
    this._columns = columns;

    this._data = data || [];
    
    this._state = {
      columnFilters: [], columnOrder: [], columnPinning: { left: [], right: [] },
      columnSizing: {}, columnVisibility: {}, expanded: {}, globalFilter: undefined,
      grouping: [], pagination: { pageIndex: 0, pageSize: 10 }, rowSelection: {},
      sorting: [],
      ...initialState,
    };

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
        isLoading: true,
        isFetching: true,
        isLookupPending: false,
        error: this.error,
    };
  }

  public connect(): () => void {
    vg.coordinator().connect(this);
    this.initializeSelections();
    return this.destroy.bind(this);
  }

  public initializeSelections() {
    if (this.hoverSelection) {
        this.hoverSelection.update({ source: this.sourceName, predicate: literal(false) });
    }
    if (this.clickSelection) {
        this.clickSelection.update({ source: this.sourceName, predicate: null });
    }
  }

  public destroy() {
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
  
  fields() {
    let fromTable: string | undefined = this.sourceTable;

    if (!fromTable) {
        const baseQuery = this.getBaseQuery({});
        // @ts-ignore - This is our fallback heuristic
        const fromClause = baseQuery.clauses.from[0];
        fromTable = fromClause?.from;
    }

    if (!fromTable || typeof fromTable !== 'string') {
        throw new Error(`Could not determine a source table for metadata query in ${this.sourceName}. Please add a 'sourceTable' property to your logic config.`);
    }
    
    const baseColumns = this._columns.map(c => c.id).filter(id => id && !['select', 'rank'].includes(id));
    const query = Query.from(fromTable)
        .select(...baseColumns);
    return query;
  }

  fieldInfo(info: { column: string, type: any }[]) {
    this._schema.clear();
    for (const { column, type } of info) {
        this._schema.set(column, type);
    }
    this.requestQuery();
  }

  public handleRowHover = (rowObject: TData | null): void => {
    if (this.hoverSelection && this.hoverInteraction) {
      const predicate = rowObject 
        ? this.hoverInteraction.createPredicate(rowObject) 
        : literal(false);
      this.hoverSelection.update({ source: this.sourceName, predicate });
    }
  }

  public handleRowClick = (rowObject: TData | null): void => {
    if (this.clickSelection && this.clickInteraction) {
      const predicate = rowObject 
        ? this.clickInteraction.createPredicate(rowObject) 
        : null;
      this.clickSelection.update({ source: this.sourceName, predicate });
    }
  }

  private get _hasGlobalFilter(): boolean {
    return this._columns.some(c => c.meta?.enableGlobalFilter);
  }

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

    if (this.primaryKey.length > 0 && !tableOptions.getRowId) {
        tableOptions.getRowId = (row: TData) => {
          const keyParts = this.primaryKey.map(key => (row as any)[key]);
          return JSON.stringify(keyParts);
        };
    }
    
    return createTable<TData>(tableOptions);
  }

  private _updateState(updater: Updater<TableState>) {
    const prevState = this._state;
    const newState = typeof updater === 'function' ? updater(prevState) : updater;
    
    if (JSON.stringify(prevState) === JSON.stringify(newState)) return;

    const filterChanged = JSON.stringify(newState.columnFilters) !== JSON.stringify(prevState.columnFilters) || newState.globalFilter !== prevState.globalFilter;
    const sortChanged = JSON.stringify(newState.sorting) !== JSON.stringify(prevState.sorting);
    const paginationChanged = JSON.stringify(newState.pagination) !== JSON.stringify(prevState.pagination);
    const rowSelectionChanged = JSON.stringify(newState.rowSelection) !== JSON.stringify(prevState.rowSelection);

    if (filterChanged && newState.pagination.pageIndex !== 0) {
        newState.pagination = { ...newState.pagination, pageIndex: 0 };
    }
    
    this._state = newState;
    this._table = this._createTable();
    this._notifyListeners(); 
    
    if (filterChanged) {
        this._handleInternalFilterChange();
        this.requestQuery();
    } else if (sortChanged || paginationChanged) {
        this.requestQuery();
    }

    if (rowSelectionChanged) {
        this._handleRowSelectionChange(newState, prevState);
    }
  }

  private _handleRowSelectionChange(newState: TableState, prevState: TableState) {
    if (!this.rowSelectionSelection) return;
    const newKeys = new Set(Object.keys(newState.rowSelection));
    const oldKeys = new Set(Object.keys(prevState.rowSelection));
    if (newKeys.size === oldKeys.size && [...newKeys].every(key => oldKeys.has(key))) return;
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
    const activePredicates = Array.from(this._rowSelectionPredicates.values()).filter((p): p is SQLAst => p !== null);
    const finalPredicate = activePredicates.length > 0 ? or(...activePredicates) : null;
    this.rowSelectionSelection.update({ source: `${this.sourceName}_row_selection`, predicate: finalPredicate });
  }

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

  private async _handleInternalFilterChange() {
    if (!this.internalFilterSelection) return;

    /**
     * --- ADVANCED: HANDLING POST-AGGREGATION FILTERS (HAVING) ---
     * When a filter is applied to an aggregated column (e.g., searching for "1,234" in a COUNT column),
     * it cannot be placed in a standard WHERE clause. It must go in a HAVING clause.
     *
     * However, the broader Mosaic dashboard needs a single WHERE predicate to function correctly
     * for cross-filtering. We solve this with a "reverse lookup" pattern:
     *
     * 1. Run a fast, preliminary query that applies ONLY the HAVING clause filters to find all the
     *    primaryKey groups that satisfy the post-aggregation filter.
     * 2. Construct a large `WHERE primaryKey IN (...)` predicate from the results of that query.
     * 3. Combine this new predicate with any standard WHERE filters.
     *
     * This effectively transforms the post-aggregation filter into a pre-aggregation one that
     * can be broadcast to the rest of the application. This is a powerful but potentially
     * performance-intensive operation, hence the `isLookupPending` state.
     */
    const { where, having } = this._generateFilterPredicates(this._state);
    let finalPredicate: SQLAst | null = null;
    if (having.length > 0) {
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
    this.internalFilterSelection.update({ source: `${this.sourceName}_internal_filters`, predicate: finalPredicate });
  }
  
  public createPredicateFromRowId(id: string): SQLAst | null {
    if (this.primaryKey.length === 0) {
      console.warn('Cannot create predicate from row ID: No primaryKey is defined for this table.');
      return null;
    }
    try {
      const keyValues = JSON.parse(id);
      if (!Array.isArray(keyValues) || keyValues.length !== this.primaryKey.length) {
        console.error('Mismatched row ID format. Expected an array with length', this.primaryKey.length);
        return null;
      }
      const keyPredicates = this.primaryKey.map((key, i) => eq(key, literal(keyValues[i])));
      return and(...keyPredicates);
    } catch (e) {
      console.error('Failed to parse row ID.', id, e);
      return null;
    }
  }

  get filterStable(): boolean { return false; }

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

    const finalQuery = Query.with({ [baseQueryAlias]: baseQuery })
      .from(baseQueryAlias)
      .select('*', { total_rows: vg.count().window() })
      .orderby(order)
      .limit(pagination.pageSize)
      .offset(pagination.pageIndex * pagination.pageSize);
      
    return finalQuery;
  }

  public abstract getBaseQuery(filters: { where?: any, having?: any }): Query;

  queryResult(data: any): this {
    this._loadingState = 'idle';
    this.error = null;
    const rows: TData[] = (data && typeof data.toArray === 'function') ? data.toArray().map((row: object) => ({ ...row })) : [];
    this._data = rows;
    const rowCount = this._data.length > 0 ? (this._data[0] as any).total_rows : 0;
    this._table = this._createTable();
    this._table.setOptions(prev => ({ ...prev, rowCount }));
    this._notifyListeners();
    return this;
  }

  queryPending(): this {
    this._loadingState = 'fetching';
    this.error = null;
    this._notifyListeners();
    return this;
  }
  
  queryError(error: Error): this {
    this._loadingState = 'idle';
    this.error = error;
    this._notifyListeners();
    return this;
  }

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
  
  public get table(): Table<TData> { return this._table; }
  public get state(): TableState { return this._state; }
}