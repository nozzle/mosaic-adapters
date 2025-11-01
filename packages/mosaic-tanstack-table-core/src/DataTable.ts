// packages/mosaic-tanstack-core/src/DataTable.ts
/**
 * @file This file defines the generic, framework-agnostic `DataTable` base class.
 * It acts as a bridge, extending MosaicClient to handle data fetching and
 * implementing a subscription model to push state updates to any UI framework.
 * This version is "Arrow-native," retaining the binary Arrow Table from query
 * results for high-performance rendering in consuming UI libraries.
 */
import {
  MosaicClient,
  Selection,
  // @ts-expect-error Module '"@uwdata/mosaic-core"' has no exported member 'FilterExpr'
  type FilterExpr,
  Param,
} from '@uwdata/mosaic-core';
import {
  literal,
  isIn,
  and,
  sql,
  or,
  Query,
  desc,
  asc,
  eq,
  // @ts-expect-error Module '"@uwdata/mosaic-sql"' has no exported member 'SQLAst'
  type SQLAst,
} from '@uwdata/mosaic-sql';
import * as vg from '@uwdata/vgplot';
import {
  createTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getGroupedRowModel,
  type Table,
  type TableOptions,
  type ColumnDef,
  type TableState,
  type Updater,
  type Column,
} from '@tanstack/table-core';
import { Table as ArrowTable } from 'apache-arrow';

// --- GENERIC TYPE DEFINITIONS ---

/**
 * Extends TanStack Table's `TableMeta` to include custom properties, such as
 * callbacks for row interactions.
 */
export interface CustomTableMeta<TData extends object> {
  onRowHover?: (row: TData | null) => void;
  onRowClick?: (row: TData | null) => void;
  hasGlobalFilter?: boolean;
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
  // @ts-expect-error
  interface TableMeta<TData extends object> extends CustomTableMeta<TData> {}
  // @ts-expect-error
  interface ColumnMeta<TData extends object, TValue>
    // @ts-expect-error
    extends CustomColumnMeta<TData, TValue> {}
}

/**
 * Extends TanStack's `ColumnDef` to include an optional `sql` property,
 * allowing a column to be defined by a raw SQL expression.
 */
export interface MosaicColumnDef<TData extends object>
  // @ts-expect-error
  extends ColumnDef<TData> {
  sql?: string | SQLAst;
}

/**
 * Defines a column's LOGIC properties, explicitly omitting UI renderers (`header`, `cell`)
 * to maintain a clean separation between data logic and presentation.
 */
export type LogicColumnDef<T extends object> = Omit<
  MosaicColumnDef<T>,
  'header' | 'cell' | 'meta'
> & {
  meta?: { enableGlobalFilter?: boolean };
};

/**
 * Defines the shape of the UI configuration for a single column, including
 * framework-agnostic placeholders for rendering components.
 */
export interface ColumnUIConfig<T extends object> {
  header?: ColumnDef<T, unknown>['header'] | any;
  cell?: ColumnDef<T, unknown>['cell'] | any;
  meta?: { Filter?: any };
}

/**
 * Defines the top-level UI configuration object as a map from a column ID
 * to its specific UI config.
 */
export type DataTableUIConfig<T extends object> = {
  [columnId in string]?: ColumnUIConfig<T>;
};

/**
 * Defines a contract for generating a SQL predicate from a single data row,
 * used for point-based interactions like hover and click.
 */
export interface InteractionConfig<T extends object> {
  createPredicate: (row: T) => SQLAst | null;
}

/**
 * The complete set of options for constructing a `DataTable` instance.
 * It extends TanStack's options and adds Mosaic-specific configurations.
 */
export interface DataTableOptions<TData extends object>
  extends Omit<
    TableOptions<TData>,
    'data' | 'columns' | 'state' | 'onStateChange' | 'renderFallbackValue'
  > {
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
  pageParam?: Param<number>;
  pageSizeParam?: Param<number>;
}

// --- THIS IS THE FIX: The full, correct type definition is now provided. ---

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
interface LogicConfigWithoutRowSelection<T extends object>
  extends BaseDataTableLogicConfig<T> {
  primaryKey?: string[];
  options?: Omit<DataTableOptions<T>, 'meta' | 'enableRowSelection'> & {
    enableRowSelection?: false;
  };
}

/**
 * Logic configuration for a table where row selection is enabled, requiring a primary key.
 */
interface LogicConfigWithRowSelection<T extends object>
  extends BaseDataTableLogicConfig<T> {
  primaryKey: string[];
  options: Omit<DataTableOptions<T>, 'meta' | 'enableRowSelection'> & {
    enableRowSelection: true;
  };
}

/**
 * Represents the framework-agnostic "logic" configuration for a `DataTable`.
 * It is a discriminated union to enforce that a `primaryKey` is provided
 * when `enableRowSelection` is true.
 */
export type DataTableLogicConfig<T extends object> =
  | LogicConfigWithoutRowSelection<T>
  | LogicConfigWithRowSelection<T>;

// --- END FIX ---

/**
 * Defines the state snapshot that the `DataTable` provides to its subscribers.
 * This object contains everything a UI framework needs to render the table.
 */
export interface DataTableSnapshot<TData extends object> {
  /** The fully-configured TanStack Table instance for UI logic and rendering. */
  table: Table<TData>;
  /** The raw Apache Arrow table from the last successful query for high-performance rendering. */
  arrowTable: ArrowTable | null;
  /** True if the table has never received data and a query is in flight. */
  isLoading: boolean;
  /** True if a query is currently in flight, even if stale data is present. */
  isFetching: boolean;
  /** True if a secondary lookup query (for filtering on aggregates) is in flight. */
  isLookupPending: boolean;
  /** An error object if the last query failed. */
  error: Error | null;
}

/** Represents the possible loading states of the data table. */
type LoadingState = 'idle' | 'fetching' | 'lookup';

/**
 * A generic, framework-agnostic class that bridges Mosaic data fetching with
 * TanStack Table state management. It acts as a headless controller for a data grid.
 */
export abstract class DataTable<
  TData extends object = any,
> extends MosaicClient {
  /** The active TanStack Table instance. */
  protected _table: Table<TData>;
  /** The column definitions for the table. */
  protected _columns: MosaicColumnDef<TData>[];
  /** The current page of data, converted to a JavaScript array for TanStack compatibility. */
  protected _data: TData[];
  /** The raw Apache Arrow table from the most recent query result. */
  protected _arrowData: ArrowTable | null = null;
  /** The complete state object for the TanStack Table instance (sorting, pagination, etc.). */
  protected _state: TableState;
  /** The original TanStack Table options, preserved for recreating the table instance. */
  protected _options: Omit<
    TableOptions<TData>,
    'data' | 'columns' | 'state' | 'onStateChange' | 'renderFallbackValue'
  >;

  // Mosaic selection objects for various interaction types.
  protected internalFilterSelection?: Selection;
  protected rowSelectionSelection?: Selection;
  protected hoverSelection?: Selection;
  protected clickSelection?: Selection;

  /** A unique name for this client, used to source selection updates. */
  protected sourceName: string;
  /** The primary database table to query for schema metadata if not otherwise discoverable. */
  protected sourceTable?: string;
  /** Optional Mosaic Param for two-way binding of the current page index. */
  protected pageParam?: Param<number>;
  /** Optional Mosaic Param for two-way binding of the current page size. */
  protected pageSizeParam?: Param<number>;

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
      pageParam,
      pageSizeParam,
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
    this.pageParam = pageParam;
    this.pageSizeParam = pageSizeParam;

    if (
      this._options.enableRowSelection &&
      (!this.primaryKey || this.primaryKey.length === 0)
    ) {
      const tableName = name || this.constructor.name;
      throw new Error(
        `[Mosaic-Tanstack Adapter Error in table "${tableName}"]\n` +
          `'enableRowSelection' is true, but a 'primaryKey' array was not provided in the logic configuration.\n` +
          `A primary key is required to uniquely identify rows for selection.\n` +
          `Please add a 'primaryKey' property (e.g., primaryKey: ['id']) to your DataTableLogicConfig.`,
      );
    }

    this._columns = columns;
    this._data = data || [];

    // @ts-expect-error Type 'RowPinningState | undefined' is not assignable to type 'RowPinningState'
    this._state = {
      columnFilters: [],
      columnOrder: [],
      columnPinning: { left: [], right: [] },
      columnSizing: {},
      columnVisibility: {},
      expanded: {},
      globalFilter: undefined,
      grouping: [],
      pagination: {
        pageIndex:
          this.pageParam?.value ?? initialState?.pagination?.pageIndex ?? 0,
        pageSize:
          this.pageSizeParam?.value ?? initialState?.pagination?.pageSize ?? 10,
      },
      rowSelection: {},
      sorting: [],
      ...initialState,
    };

    if (!this.hoverInteraction && this.primaryKey.length > 0) {
      this.hoverInteraction = {
        createPredicate: (row) => {
          const predicates = this.primaryKey.map((key) =>
            eq(key, literal((row as any)[key])),
          );
          return and(...predicates);
        },
      };
    }
    if (!this.clickInteraction && this.primaryKey.length > 0) {
      this.clickInteraction = {
        createPredicate: (row) => {
          const predicates = this.primaryKey.map((key) =>
            eq(key, literal((row as any)[key])),
          );
          return and(...predicates);
        },
      };
    }

    this._table = this._createTable();

    this._snapshot = {
      table: this._table,
      arrowTable: this._arrowData,
      isLoading: true,
      isFetching: true,
      isLookupPending: false,
      error: this.error,
    };
  }

  /**
   * Connects this client to the Mosaic coordinator and sets up subscriptions.
   * @returns A cleanup function to be called on component unmount.
   */
  public connect(): () => void {
    vg.coordinator().connect(this);
    this.initializeSelections();

    const pageSub = this.pageParam?.addEventListener('value', (pageIndex) => {
      this.table.setPageIndex(pageIndex);
    });
    const pageSizeSub = this.pageSizeParam?.addEventListener(
      'value',
      (pageSize) => {
        this.table.setPageSize(pageSize);
      },
    );

    const originalDestroy = this.destroy.bind(this);

    return () => {
      if (pageSub) this.pageParam?.removeEventListener('value', pageSub);
      if (pageSizeSub)
        this.pageSizeParam?.removeEventListener('value', pageSizeSub);
      originalDestroy();
    };
  }

  /**
   * Initializes or clears interaction-based selections upon connection.
   */
  public initializeSelections() {
    if (this.hoverSelection) {
      this.hoverSelection.update({
        // @ts-expect-error Type 'string' is not assignable to type 'ClauseSource'
        source: this.sourceName,
        predicate: literal(false),
      });
    }
    if (this.clickSelection) {
      this.clickSelection.update({
        // @ts-expect-error Type 'string' is not assignable to type 'ClauseSource'
        source: this.sourceName,
        predicate: null,
      });
    }
  }

  /**
   * Disconnects from the coordinator and cleans up selections and listeners.
   */
  public destroy() {
    const source = this.sourceName;
    if (this.internalFilterSelection)
      this.internalFilterSelection.update({
        // @ts-expect-error Type 'string' is not assignable to type 'ClauseSource'
        source,
        predicate: null,
      });
    if (this.rowSelectionSelection)
      this.rowSelectionSelection.update({
        // @ts-expect-error Type 'string' is not assignable to type 'ClauseSource'
        source,
        predicate: null,
      });
    if (this.hoverSelection)
      this.hoverSelection.update({
        // @ts-expect-error Type 'string' is not assignable to type 'ClauseSource'
        source,
        predicate: null,
      });
    if (this.clickSelection)
      this.clickSelection.update({
        // @ts-expect-error Type 'string' is not assignable to type 'ClauseSource'
        source,
        predicate: null,
      });

    if (this.coordinator) {
      this.coordinator.disconnect(this);
    }

    this._listeners.clear();
  }

  /**
   * Part of the MosaicClient lifecycle. Generates a query to fetch schema metadata.
   */
  fields() {
    let fromTable: string | undefined = this.sourceTable;

    if (!fromTable) {
      const baseQuery = this.getBaseQuery({});
      // @ts-ignore - Fallback heuristic to introspect the base query for its source table.
      const fromClause = baseQuery.clauses.from[0];
      fromTable = fromClause?.from;
    }

    if (!fromTable || typeof fromTable !== 'string') {
      throw new Error(
        `Could not determine a source table for metadata query in ${this.sourceName}. Please add a 'sourceTable' property to your logic config.`,
      );
    }

    const baseColumns = this._columns
      // @ts-expect-error Property 'id' does not exist on type 'MosaicColumnDef<TData>'
      .map((c) => c.id)
      .filter((id) => id && !['select', 'rank'].includes(id));
    const query = Query.from(fromTable).select(...baseColumns);
    return query;
  }

  /**
   * Part of the MosaicClient lifecycle. Receives schema info and caches it.
   */
  fieldInfo(info: { column: string; type: any }[]) {
    this._schema.clear();
    for (const { column, type } of info) {
      this._schema.set(column, type);
    }
    this.requestQuery();
  }

  /**
   * Handler for row hover events, which updates the `hoverAs` selection.
   */
  public handleRowHover = (rowObject: TData | null): void => {
    if (this.hoverSelection && this.hoverInteraction) {
      const predicate = rowObject
        ? this.hoverInteraction.createPredicate(rowObject)
        : literal(false);
      this.hoverSelection.update({
        // @ts-expect-error Type 'string' is not assignable to type 'ClauseSource'
        source: this.sourceName,
        predicate,
      });
    }
  };

  /**
   * Handler for row click events, which updates the `clickAs` selection.
   */
  public handleRowClick = (rowObject: TData | null): void => {
    if (this.clickSelection && this.clickInteraction) {
      const predicate = rowObject
        ? this.clickInteraction.createPredicate(rowObject)
        : null;
      this.clickSelection.update({
        // @ts-expect-error Type 'string' is not assignable to type 'ClauseSource'
        source: this.sourceName,
        predicate,
      });
    }
  };

  /**
   * A computed property to check if any column is configured for global filtering.
   */
  private get _hasGlobalFilter(): boolean {
    // @ts-expect-error Property 'meta' does not exist on type 'MosaicColumnDef<TData>'.
    return this._columns.some((c) => c.meta?.enableGlobalFilter);
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
      },
      data: this._data,
      // @ts-expect-error Type 'MosaicColumnDef<TData>[]' is not assignable to type 'ColumnDef<TData, any>[]'
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
        const keyParts = this.primaryKey.map((key) => (row as any)[key]);
        return JSON.stringify(keyParts);
      };
    }

    // @ts-expect-error Argument of type 'TableOptions<TData>' is not assignable to parameter of type 'TableOptionsResolved<TData>'
    return createTable<TData>(tableOptions);
  }

  /**
   * The core state update handler. Called by TanStack Table whenever an action occurs.
   * It determines what changed and triggers the appropriate Mosaic-side effect.
   */
  private _updateState(updater: Updater<TableState>) {
    const prevState = this._state;
    const newState =
      typeof updater === 'function' ? updater(prevState) : updater;

    if (JSON.stringify(prevState) === JSON.stringify(newState)) return;

    const filterChanged =
      JSON.stringify(newState.columnFilters) !==
        JSON.stringify(prevState.columnFilters) ||
      newState.globalFilter !== prevState.globalFilter;
    const sortChanged =
      JSON.stringify(newState.sorting) !== JSON.stringify(prevState.sorting);
    const paginationChanged =
      JSON.stringify(newState.pagination) !==
      JSON.stringify(prevState.pagination);
    const rowSelectionChanged =
      JSON.stringify(newState.rowSelection) !==
      JSON.stringify(prevState.rowSelection);

    if (filterChanged && newState.pagination.pageIndex !== 0) {
      newState.pagination = { ...newState.pagination, pageIndex: 0 };
    }

    this._state = newState;
    this._table = this._createTable();
    this._notifyListeners();

    if (
      this.pageParam &&
      this.pageParam.value !== newState.pagination.pageIndex
    ) {
      this.pageParam.update(newState.pagination.pageIndex);
    }
    if (
      this.pageSizeParam &&
      this.pageSizeParam.value !== newState.pagination.pageSize
    ) {
      this.pageSizeParam.update(newState.pagination.pageSize);
    }

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

  /**
   * Translates changes in TanStack's row selection state into an `OR`'d SQL
   * predicate and updates the `rowSelectionAs` Mosaic Selection.
   */
  private _handleRowSelectionChange(
    newState: TableState,
    prevState: TableState,
  ) {
    if (!this.rowSelectionSelection) return;
    const newKeys = new Set(Object.keys(newState.rowSelection));
    const oldKeys = new Set(Object.keys(prevState.rowSelection));
    if (
      newKeys.size === oldKeys.size &&
      [...newKeys].every((key) => oldKeys.has(key))
    )
      return;
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
    const activePredicates = Array.from(
      this._rowSelectionPredicates.values(),
    ).filter((p): p is SQLAst => p !== null);
    const finalPredicate =
      activePredicates.length > 0 ? or(...activePredicates) : null;
    this.rowSelectionSelection.update({
      // @ts-expect-error Type 'string' is not assignable to type 'ClauseSource
      source: `${this.sourceName}_row_selection`,
      predicate: finalPredicate,
    });
  }

  /**
   * Generates SQL predicates from the current TanStack filter state (`columnFilters`
   * and `globalFilter`), correctly separating them into `WHERE` and `HAVING` clauses
   * if the query is grouped.
   */
  private _generateFilterPredicates(state: TableState): {
    where: SQLAst[];
    having: SQLAst[];
  } {
    const createPredicate = (id: string, value: any) =>
      sql`CAST(${id} AS VARCHAR) ILIKE ${literal(`%${value}%`)}`;
    if (this.groupByKeys.length === 0) {
      const where: SQLAst[] = [];
      for (const f of state.columnFilters)
        if (f.value != null && f.value !== '')
          where.push(createPredicate(f.id, f.value));
      if (state.globalFilter) {
        const searchableColumns = this._columns.filter(
          // @ts-expect-error Property 'meta' does not exist on type 'MosaicColumnDef<TData>'
          (c) => c.meta?.enableGlobalFilter,
        );
        const globalPredicates = searchableColumns.map((c) =>
          // @ts-expect-error Property 'id' does not exist on type 'MosaicColumnDef<TData>'
          createPredicate(c.id!, state.globalFilter),
        );
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
      const searchableColumns = this._columns.filter(
        // @ts-expect-error Property 'meta' does not exist on type 'MosaicColumnDef<TData>'
        (c) => c.meta?.enableGlobalFilter,
      );
      const globalWherePredicates: SQLAst[] = [],
        globalHavingPredicates: SQLAst[] = [];
      searchableColumns.forEach((c) => {
        // @ts-expect-error Property 'id' does not exist on type 'MosaicColumnDef<TData>'
        const predicate = createPredicate(c.id!, state.globalFilter);
        // @ts-expect-error Property 'id' does not exist on type 'MosaicColumnDef<TData>'
        if (this.groupByKeys.includes(c.id!))
          globalWherePredicates.push(predicate);
        else globalHavingPredicates.push(predicate);
      });
      if (globalWherePredicates.length > 0)
        where.push(or(...globalWherePredicates));
      if (globalHavingPredicates.length > 0)
        having.push(or(...globalHavingPredicates));
    }
    return { where, having };
  }

  /**
   * Handles changes to the internal filter state, potentially performing a "reverse lookup"
   * query if filtering is needed on an aggregated column. Updates the `internalFilterAs` selection.
   */
  private async _handleInternalFilterChange() {
    if (!this.internalFilterSelection) return;

    const { where, having } = this._generateFilterPredicates(this._state);
    let finalPredicate: SQLAst | null = null;
    if (having.length > 0) {
      this._loadingState = 'lookup';
      this._notifyListeners();
      try {
        const externalPredicate = this.filterBy?.predicate(this);
        const lookupQuery = this.getBaseQuery({
          where: externalPredicate,
          having: having,
          // @ts-expect-error Property 'select' does not exist on type 'Query'. Did you mean to access the static member 'Query.select' instead?
        }).select(this.groupByKeys);
        const result = await this.coordinator!.query(lookupQuery);
        const validKeys = result.toArray().map((row: any) => ({ ...row }));
        if (validKeys.length > 0) {
          const keyPredicates = validKeys.map((keyRow) => {
            const keyParts = this.groupByKeys.map((key) =>
              eq(key, literal(keyRow[key])),
            );
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
    this.internalFilterSelection.update({
      // @ts-expect-error Type 'string' is not assignable to type 'ClauseSource'.
      source: `${this.sourceName}_internal_filters`,
      predicate: finalPredicate,
    });
  }

  /**
   * Creates a SQL predicate to uniquely identify a row based on its ID,
   * which is a JSON string of its primary key values.
   */
  public createPredicateFromRowId(id: string): SQLAst | null {
    if (this.primaryKey.length === 0) {
      console.warn(
        'Cannot create predicate from row ID: No primaryKey is defined for this table.',
      );
      return null;
    }
    try {
      const keyValues = JSON.parse(id);
      if (
        !Array.isArray(keyValues) ||
        keyValues.length !== this.primaryKey.length
      ) {
        console.error(
          'Mismatched row ID format. Expected an array with length',
          this.primaryKey.length,
        );
        return null;
      }
      const keyPredicates = this.primaryKey.map((key, i) =>
        eq(key, literal(keyValues[i])),
      );
      return and(...keyPredicates);
    } catch (e) {
      console.error('Failed to parse row ID.', id, e);
      return null;
    }
  }

  /**
   * Part of the MosaicClient interface, indicates if filter changes affect the query's grouping.
   */
  get filterStable(): boolean {
    return false;
  }

  /**
   * Part of the MosaicClient interface. Builds the final SQL query to be executed,
   * combining the external filter with the internal TanStack state (sorting, pagination).
   */
  public query(externalFilter?: FilterExpr): Query {
    const internalFilters = this._generateFilterPredicates(this.state);
    const combinedWhere = and(externalFilter, ...internalFilters.where);
    const baseQuery = this.getBaseQuery({
      where: combinedWhere,
      having: internalFilters.having,
    });

    const { sorting, pagination } = this.state;
    const baseQueryAlias = `${this.sourceName}_base`;
    const order = sorting.map((s) => (s.desc ? desc(s.id) : asc(s.id)));

    // Wraps the base query to apply sorting, pagination, and a total row count window function.
    const finalQuery = Query.with({ [baseQueryAlias]: baseQuery })
      .from(baseQueryAlias)
      .select('*', { total_rows: vg.count().window() })
      .orderby(order)
      .limit(pagination.pageSize)
      .offset(pagination.pageIndex * pagination.pageSize);

    return finalQuery;
  }

  /**
   * An abstract method that must be implemented by a concrete subclass.
   * It defines the core SELECT and FROM clauses of the table's query.
   */
  public abstract getBaseQuery(filters: { where?: any; having?: any }): Query;

  /**
   * Part of the MosaicClient lifecycle. Called by the Coordinator with the query result.
   */
  queryResult(data: ArrowTable): this {
    this._loadingState = 'idle';
    this.error = null;

    // Store the raw ArrowTable for high-performance rendering.
    this._arrowData = data;

    // Convert to a JS array for TanStack Table's internal logic.
    // @ts-expect-error Type '{}[]' is not assignable to type 'TData[]'
    const rows: TData[] =
      data && typeof data.toArray === 'function'
        ? data.toArray().map((row: object) => ({ ...row }))
        : [];
    this._data = rows;

    // Extract total row count from the special window function column.
    const rowCount =
      this._data.length > 0 ? (this._data[0] as any).total_rows : 0;

    // Recreate the TanStack Table instance with the new data and total count.
    this._table = this._createTable();
    this._table.setOptions((prev) => ({ ...prev, rowCount }));

    // Notify all UI subscribers that new data is available.
    this._notifyListeners();
    return this;
  }

  /**
   * Part of the MosaicClient lifecycle. Called when a query is pending.
   */
  queryPending(): this {
    this._loadingState = 'fetching';
    this.error = null;
    this._notifyListeners();
    return this;
  }

  /**
   * Part of the MosaicClient lifecycle. Called when a query fails.
   */
  queryError(error: Error): this {
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
    return () => {
      this._listeners.delete(listener);
    };
  };

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
      arrowTable: this._arrowData,
      isLoading: this._loadingState !== 'idle' && this._data.length === 0,
      isFetching: this._loadingState === 'fetching',
      isLookupPending: this._loadingState === 'lookup',
      error: this.error,
    };
    this._listeners.forEach((listener) => listener());
  };

  /** Public getter for the current TanStack Table instance. */
  public get table(): Table<TData> {
    return this._table;
  }
  /** Public getter for the current TanStack Table state. */
  public get state(): TableState {
    return this._state;
  }
}
