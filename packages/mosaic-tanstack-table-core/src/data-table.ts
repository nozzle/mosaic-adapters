/**
 * The core Orchestrator for the Mosaic <-> TanStack Table integration.
 * Manages state, schema mapping, query generation, and facet sidecars.
 */

import {
  MosaicClient,
  Selection,
  coordinator as defaultCoordinator,
  isArrowTable,
  isParam,
  queryFieldInfo,
} from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { getCoreRowModel, getFacetedRowModel } from '@tanstack/table-core';
import { Store, batch } from '@tanstack/store';
import {
  createStructAccess,
  functionalUpdate,
  seedInitialTableState,
  toSafeSqlColumnName,
} from './utils';
import { logger } from './logger';
import { ColumnMapper } from './query/column-mapper';
import { buildTableQuery, extractInternalFilters } from './query/query-builder';
import { MosaicSelectionManager } from './selection-manager';

import type {
  Coordinator,
  FieldInfo,
  FieldInfoRequest,
} from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  ColumnDef,
  RowData,
  Table,
  TableOptions,
} from '@tanstack/table-core';
import type {
  FacetClientConfig,
  FacetSortMode,
  MosaicDataTableOptions,
  MosaicDataTableStore,
  MosaicTableSource,
} from './types';

/**
 * This is a factory function to create a MosaicDataTable client.
 *
 * @typeParam `TData` The row data type used in TanStack Table.
 * @typeParam `TValue` The cell value type used in TanStack Table.
 * @param options Options to be passed into the constructor of the MosaicDataTable.
 * @returns A new instance of the MosaicDataTable client.
 */
export function createMosaicDataTableClient<
  TData extends RowData,
  TValue = unknown,
>(options: MosaicDataTableOptions<TData, TValue>) {
  // Initialize the table client
  const client = new MosaicDataTable<TData, TValue>(options);
  return client;
}

interface ActiveFacetClient extends MosaicClient {
  connect: () => void;
  disconnect: () => void;
}

type MinMaxResult = { min: number; max: number };

/**
 * A Mosaic Client that does the glue work to drive TanStack Table, using it's
 * TableOptions for configuration.
 */
export class MosaicDataTable<
  TData extends RowData,
  TValue = unknown,
> extends MosaicClient {
  source: MosaicTableSource;
  schema: Array<FieldInfo> = [];
  tableFilterSelection!: Selection;
  // Hold options to access highlightBy later
  options: MosaicDataTableOptions<TData, TValue>;

  // DO NOT remove the `!` here. We guarantee initialization in updateOptions which is also called by the constructor.
  #store!: Store<MosaicDataTableStore<TData, TValue>>;
  #sql_total_rows = toSafeSqlColumnName('__total_rows');
  #onTableStateChange: 'requestQuery' | 'requestUpdate' = 'requestUpdate';

  // The Mapper handles all ColumnDef <-> SQL Column logic
  #columnMapper!: ColumnMapper<TData, TValue>;

  // Registry to track active facet sidecar clients.
  #facetClients: Map<string, ActiveFacetClient> = new Map();
  #facetValues: Map<string, any> = new Map();

  // Manager for row selection sync
  #rowSelectionManager?: MosaicSelectionManager;

  #QueryStore: any;

  constructor(options: MosaicDataTableOptions<TData, TValue>) {
    super(options.filterBy); // pass the appropriate Filter Selection
    this.options = options;
    this.source = options.table;

    this.updateOptions(options);
  }

  /**
   * When options are updated from framework-land, we need to update
   * the internal store and state accordingly.
   * @param options The updated options from framework-land.
   */
  updateOptions(options: MosaicDataTableOptions<TData, TValue>): void {
    this.options = options;

    if (options.onTableStateChange) {
      this.#onTableStateChange = options.onTableStateChange;
    }

    this.source = options.table;

    if (options.tableFilterSelection) {
      this.tableFilterSelection = options.tableFilterSelection;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (!this.tableFilterSelection) {
      this.tableFilterSelection = new Selection();
    }

    // Initialize Row Selection Manager if config provided
    if (options.rowSelection) {
      this.#rowSelectionManager = new MosaicSelectionManager({
        client: this,
        column: options.rowSelection.column,
        selection: options.rowSelection.selection,
        isArrayColumn: options.rowSelection.isArrayColumn,
      });
    } else {
      this.#rowSelectionManager = undefined;
    }

    // Robustly resolve the coordinator.
    // 1. Try options.coordinator
    // 2. Try existing this.coordinator
    // 3. Fallback to defaultCoordinator()
    // Cast to undefined to allow the check to pass linting if TS thinks it's always defined
    const resolvedCoordinator =
      options.coordinator || this.coordinator || defaultCoordinator();

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!resolvedCoordinator) {
      logger.warn(
        'Core',
        'MosaicDataTable initialized without a valid Coordinator. Queries will fail.',
      );
    }
    this.coordinator = resolvedCoordinator;

    type ResolvedStore = MosaicDataTableStore<TData, TValue>;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!this.#store) {
      this.#store = new Store({
        tableState: seedInitialTableState<TData>(
          options.tableOptions?.initialState,
        ),
        tableOptions: {
          ...(options.tableOptions ?? {}),
        } as ResolvedStore['tableOptions'],
        rows: [] as ResolvedStore['rows'],
        totalRows: undefined as ResolvedStore['totalRows'],
        columnDefs: options.columns ?? ([] as ResolvedStore['columnDefs']),
        _facetsUpdateCount: 0,
      });
    } else {
      this.#store.setState((prev) => ({
        ...prev,
        columnDefs:
          options.columns !== undefined ? options.columns : prev.columnDefs,
      }));
    }

    // If columns are provided, update the mapper.
    if (options.columns) {
      this.#columnMapper = new ColumnMapper(options.columns);
      this.#initializeAutoFacets(options.columns);
    }
  }

  /**
   * Scans column definitions for facet configuration and initializes sidecar clients.
   */
  #initializeAutoFacets(columns: Array<ColumnDef<TData, TValue>>) {
    columns.forEach((col) => {
      const facetType = col.meta?.mosaicDataTable?.facet;
      const colId = col.id;

      if (!facetType || !colId) {
        return;
      }

      switch (facetType) {
        case 'unique':
          this.loadColumnFacet(colId);
          break;
        case 'minmax':
          this.loadColumnMinMax(colId);
          break;
      }
    });
  }

  /**
   * Normalizes the polymorphic `table` option into a concrete source string or query object.
   * Handles raw table names, Mosaic Params, and Query Factory functions.
   *
   * @param filter - The primary filter expression to apply (for Factory functions)
   */
  resolveSource(filter?: FilterExpr | null): string | SelectQuery {
    if (typeof this.source === 'function') {
      return this.source(filter);
    }
    // Unwrap Mosaic Params
    if (isParam(this.source)) {
      return this.source.value as string;
    }
    return this.source as string;
  }

  override query(primaryFilter?: FilterExpr | null | undefined): SelectQuery {
    // 1. Resolve Hard Filters (filterBy)
    // These ALWAYS remove rows (e.g. global date picker)
    const hardFilter = primaryFilter;

    // 2. Resolve Highlight Filters (highlightBy)
    // These are used for Annotation + Cross-filtering logic
    let highlightPredicate: FilterExpr | null = null;
    let crossFilterPredicate: FilterExpr | null = null;

    if (this.options.highlightBy) {
      // CROSS-FILTERING (WHERE clause):
      // We pass 'this' to predicate(). If the selection is a CrossFilter and 'this'
      // is the source, it returns null (exclude self).
      // If we didn't trigger it, we get the predicate.
      // Coalesce undefined to null to match FilterExpr type
      crossFilterPredicate = this.options.highlightBy.predicate(this) ?? null;

      // HIGHLIGHTING (CASE WHEN clause):
      // We pass 'null' to predicate(). This returns the "Global Truth" including our own selection.
      // This tells us what *should* be highlighted in the UI.
      // Coalesce undefined to null to match FilterExpr type
      highlightPredicate = this.options.highlightBy.predicate(null) ?? null;
    }

    // Combine Hard Filters + Cross-Filter Predicates for the WHERE clause
    let effectiveFilter = hardFilter;
    if (crossFilterPredicate) {
      effectiveFilter = effectiveFilter
        ? mSql.and(effectiveFilter, crossFilterPredicate)
        : crossFilterPredicate;
    }

    // Smart Highlight Logic
    // If a Cross-Filter predicate exists, the table is already filtered to show
    // only selected rows (e.g. clicking "US" in a map filters this table to "US").
    // In this state, everything is "highlighted".
    // We force highlightPredicate to null (which defaults to 1) to avoid
    // referencing columns that might not exist in the aggregated subquery logic.
    // This prevents the "Referenced table not found" crash in Cross-Filtered aggregations.
    const safeHighlightPredicate = crossFilterPredicate
      ? null
      : highlightPredicate;

    const source = this.resolveSource(effectiveFilter);
    // Force unwrap here since we guarantee initialization in updateOptions/constructor
    const tableState = this.#store.state.tableState;

    // 1. Delegate Query Building
    // The QueryBuilder handles Columns, Pagination, Sorting, and Internal Filters
    const statement = buildTableQuery({
      source,
      tableState,
      mapper: this.#columnMapper,
      totalRowsColumnName: this.#sql_total_rows,
      highlightPredicate: safeHighlightPredicate,
      manualHighlight: this.options.manualHighlight,
    });

    // 2. Apply Primary Filter (Global/External Context) if source is a string
    // If source is a Query object, the Factory likely already applied effectiveFilter.
    if (effectiveFilter && typeof this.source === 'string') {
      statement.where(effectiveFilter);
    }

    // 3. Side Effect: Update Internal Filter Selection
    // This allows bidirectional filtering (Table -> Charts)
    const internalClauses = extractInternalFilters({
      tableState,
      mapper: this.#columnMapper,
    });

    // We rely on mSql.and() to handle variadic logic (0, 1, or N items)
    const predicate =
      internalClauses.length > 0 ? mSql.and(...internalClauses) : null;

    this.tableFilterSelection.update({
      source: this,
      value: tableState.columnFilters,
      predicate: predicate,
    });

    this.#QueryStore = statement;

    return statement;
  }

  /**
   * Generates SQL Filter Expressions from the current table state,
   * excluding a specific column ID (for cascading facets).
   * Used by the Facet Sidecar Clients.
   */
  public getCascadingFilters(options: {
    excludeColumnId: string;
  }): Array<mSql.FilterExpr> {
    const tableState = this.#store.state.tableState;

    // Filter the state before passing to helper.
    const filteredState = {
      ...tableState,
      columnFilters: tableState.columnFilters.filter(
        (f) => f.id !== options.excludeColumnId,
      ),
    };

    return extractInternalFilters({
      tableState: filteredState,
      mapper: this.#columnMapper,
    });
  }

  override queryPending(): this {
    return this;
  }

  get debugPrefix(): string {
    return this.options.debugName ? `${this.options.debugName}:` : '';
  }

  override queryError(error: Error): this {
    logger.error('Core', `${this.debugPrefix}Query Error`, { error });
    logger.error(
      'Core',
      `${this.debugPrefix}Offending Query:`,
      this.#QueryStore?.toString() ?? '',
    );
    return this;
  }

  override queryResult(table: unknown): this {
    if (isArrowTable(table)) {
      let totalRows: number | undefined = undefined;

      // Convert Arrow Table to rows array for TanStack Table
      const rows = table.toArray() as Array<TData>;

      // Check for the total rows column identifier
      if (
        rows.length > 0 &&
        rows[0] &&
        typeof rows[0] === 'object' &&
        this.#sql_total_rows in rows[0]
      ) {
        const firstRow = rows[0] as Record<string, any>;
        totalRows = firstRow[this.#sql_total_rows];
      }

      batch(() => {
        this.#store.setState((prev) => {
          return {
            ...prev,
            rows,
            totalRows,
          };
        });
      });
    } else {
      logger.error('Core', 'Received non-Arrow result:', { table });
    }

    return this;
  }

  override async prepare(): Promise<void> {
    // Only infer schema if source is a direct table name
    const source = this.resolveSource();
    if (typeof source === 'string') {
      // Now fields() uses the mapper
      const schema = await queryFieldInfo(this.coordinator!, this.fields());
      this.schema = schema;
    }
    return Promise.resolve();
  }

  connect(): () => void {
    // Connect to the coordinator
    this.coordinator?.connect(this);
    this.enabled = true;

    // Connect active facet clients
    this.#facetClients.forEach((client) => {
      // Ensure facet clients have the latest coordinator
      if (this.coordinator) {
        client.coordinator = this.coordinator;
      }
      client.connect();
      client.requestUpdate();
    });

    const destroy = this.destroy.bind(this);

    // Setup the primary selection change listener to reset pagination
    const selectionCb = () => {
      // Check if the active update came from US (cross-filtering).
      const activeClause =
        this.filterBy?.active || this.options.highlightBy?.active;

      const isSelfUpdate = activeClause?.source === this;

      // 1. Reset Pagination ONLY if the update is external.
      // If we are cross-filtering (self update), the dataset size hasn't changed
      // (because we exclude ourselves), so preserving the page index is the better UX.
      // If the update came from outside, the dataset likely changed size/shape.
      if (!isSelfUpdate) {
        batch(() => {
          this.#store.setState((prev) => ({
            ...prev,
            tableState: {
              ...prev.tableState,
              pagination: {
                ...prev.tableState.pagination,
                pageIndex: 0,
              },
            },
          }));
        });
      }

      // 2. Trigger Re-Query
      // We must always re-query.
      // - If external update: Rows change -> Need new data.
      // - If self (highlight) update: Rows stay same, but `__is_highlighted` column changes
      //   (for visual dimming).
      this.requestUpdate();
    };

    // Callback for when the Mosaic Selection changes externally (Mosaic -> Table sync)
    const rowSelectionCb = () => {
      if (!this.#rowSelectionManager) {
        return;
      }

      // 1. Get values from Mosaic
      const values = this.#rowSelectionManager.getCurrentValues();

      // 2. Convert Array<Value> -> Record<RowId, boolean>
      const newRowSelection: Record<string, boolean> = {};
      values.forEach((v) => {
        newRowSelection[String(v)] = true;
      });

      // 3. Update Store (batch to avoid double renders)
      batch(() => {
        this.#store.setState((prev) => ({
          ...prev,
          tableState: {
            ...prev.tableState,
            rowSelection: newRowSelection,
          },
        }));
      });
    };

    this.filterBy?.addEventListener('value', selectionCb);
    // Also listen to highlightBy changes to trigger updates
    this.options.highlightBy?.addEventListener('value', selectionCb);

    // Listen for Row Selection changes
    if (this.options.rowSelection?.selection) {
      this.options.rowSelection.selection.addEventListener(
        'value',
        rowSelectionCb,
      );
      // Initialize state immediately
      rowSelectionCb();
    }

    return () => {
      this.enabled = false; // Prevents "Client already connected" race conditions
      this.filterBy?.removeEventListener('value', selectionCb);
      this.options.highlightBy?.removeEventListener('value', selectionCb);
      this.options.rowSelection?.selection.removeEventListener(
        'value',
        rowSelectionCb,
      );
      this.#facetClients.forEach((client) => client.disconnect());
      destroy();
    };
  }

  destroy(): void {
    super.destroy();
    this.#facetClients.forEach((client) => client.disconnect());
    // Do NOT clear #facetClients here if we want them to persist across re-connects,
    // but typically destroy() means we are tearing down.
    // For auto-facets, we might want to clear them so they are re-created if columns change.
    // However, #facetClients is map by KEY (columnId:type).
    this.#facetClients.clear();
  }

  /**
   * Loads unique values for a specific column (for Select dropdowns).
   * Respects the external `filterBy` selection AND internal cascading filters.
   */
  loadColumnFacet(columnId: string) {
    // Resolve SQL column via Mapper
    const sqlColumn = this.#columnMapper.getSqlColumn(columnId);
    if (!sqlColumn) {
      return;
    }

    // Get the sort mode from the column definition meta
    const colDef = this.#columnMapper.getColumnDef(sqlColumn);
    const sortMode = colDef?.meta?.mosaicDataTable?.facetSortMode || 'alpha';

    const clientKey = `${columnId}:unique`;
    if (this.#facetClients.has(clientKey)) {
      return;
    }

    const facetClient = new UniqueColumnValuesClient({
      source: this.source,
      column: sqlColumn,
      filterBy: this.filterBy,
      coordinator: this.coordinator,
      // Cascading logic: get filters excluding this column
      getFilterExpressions: () => {
        return this.getCascadingFilters({ excludeColumnId: columnId });
      },
      onResult: (values) => {
        this.#facetValues.set(columnId, values);
        batch(() => {
          this.#store.setState((prev) => ({
            ...prev,
            _facetsUpdateCount: prev._facetsUpdateCount + 1,
          }));
        });
      },
      // Pass the configured sort mode
      sortMode: sortMode,
      __debugName: this.debugPrefix + 'UniqueFacet:' + columnId,
    });

    this.#facetClients.set(clientKey, facetClient);
    // If the table is already enabled/connected, connect the new facet client immediately
    if (this.enabled) {
      facetClient.connect();
      facetClient.requestUpdate();
    }
  }

  /**
   * Loads Min/Max values for a column (for Range Sliders).
   */
  loadColumnMinMax(columnId: string) {
    // Resolve SQL column via Mapper
    const sqlColumn = this.#columnMapper.getSqlColumn(columnId);
    if (!sqlColumn) {
      return;
    }

    const clientKey = `${columnId}:minmax`;
    if (this.#facetClients.has(clientKey)) {
      return;
    }

    const facetClient = new MinMaxColumnValuesClient({
      source: this.source,
      column: sqlColumn,
      filterBy: this.filterBy,
      coordinator: this.coordinator,
      // Cascading logic: get filters excluding this column
      getFilterExpressions: () => {
        return this.getCascadingFilters({ excludeColumnId: columnId });
      },
      onResult: (min, max) => {
        this.#facetValues.set(columnId, [min, max]);
        batch(() => {
          this.#store.setState((prev) => ({
            ...prev,
            _facetsUpdateCount: prev._facetsUpdateCount + 1,
          }));
        });
      },
      __debugName: this.debugPrefix + 'MinMaxFacet:' + columnId,
    });

    this.#facetClients.set(clientKey, facetClient);
    // If the table is already enabled/connected, connect the new facet client immediately
    if (this.enabled) {
      facetClient.connect();
      facetClient.requestUpdate();
    }
  }

  /**
   * Map TanStack Table's ColumnDefs to Mosaic FieldInfoRequests.
   */
  fields(): Array<FieldInfoRequest> {
    const source = this.resolveSource();
    if (typeof source !== 'string') {
      // Cannot infer fields from subquery object easily without running it
      return [];
    }
    // Use the Mapper logic
    return this.#columnMapper.getMosaicFieldRequests(source);
  }

  /**
   * Map the MosaicDataTableStore state to TanStack TableOptions.
   */
  getTableOptions(
    state: Store<MosaicDataTableStore<TData, TValue>>['state'],
  ): TableOptions<TData> {
    const columns =
      state.columnDefs.length === 0
        ? this.schema.map((field) => {
            return {
              accessorKey: field.column,
              header: field.column,
            } satisfies ColumnDef<TData, TValue>;
          })
        : state.columnDefs.map((column) => {
            return column satisfies ColumnDef<TData, TValue>;
          });

    return {
      data: state.rows,
      columns,
      getCoreRowModel: getCoreRowModel(),
      getFacetedRowModel: getFacetedRowModel(),
      getFacetedUniqueValues: this.getFacetedUniqueValues(),
      getFacetedMinMaxValues: this.getFacetedMinMaxValues(),
      state: state.tableState,
      onStateChange: (updater) => {
        const hashedOldState = JSON.stringify(this.#store.state.tableState);
        const tableState = functionalUpdate(
          updater,
          this.#store.state.tableState,
        );

        this.#store.setState((prev) => ({
          ...prev,
          tableState,
        }));

        const hashedNewState = JSON.stringify(tableState);
        if (hashedOldState !== hashedNewState) {
          const oldFilters = JSON.stringify(
            JSON.parse(hashedOldState).columnFilters,
          );
          const newFilters = JSON.stringify(tableState.columnFilters);

          if (oldFilters !== newFilters) {
            this.#facetClients.forEach((client) => client.requestUpdate());
          }

          this[this.#onTableStateChange]();
        }
      },
      // Intercept Row Selection changes to sync back to Mosaic (Table -> Mosaic)
      onRowSelectionChange: (updaterOrValue) => {
        // 1. Calculate new TanStack State
        const oldState = this.#store.state.tableState.rowSelection;
        const newState = functionalUpdate(updaterOrValue, oldState);

        // 2. Update Internal Store
        this.#store.setState((prev) => ({
          ...prev,
          tableState: { ...prev.tableState, rowSelection: newState },
        }));

        // 3. Sync to Mosaic
        if (this.#rowSelectionManager) {
          const selectedValues = Object.keys(newState);
          // Convert empty object -> null (clear selection)
          const valueToSend = selectedValues.length > 0 ? selectedValues : null;
          this.#rowSelectionManager.select(valueToSend);
        }
      },
      manualPagination: true,
      manualSorting: true,
      manualFiltering: true,
      rowCount: state.totalRows,
      ...state.tableOptions,
    };
  }

  getFacetedUniqueValues<TData extends RowData>(): (
    table: Table<TData>,
    columnId: string,
  ) => () => Map<any, number> {
    return (_table, columnId) => {
      return () => {
        const values = this.getFacets().get(columnId);
        if (!values) {
          return new Map<any, number>();
        }
        if (Array.isArray(values)) {
          const map = new Map<any, number>();
          values.forEach((value) => {
            map.set(value, 1);
          });
          return map;
        }
        return new Map<any, number>();
      };
    };
  }

  getFacetedMinMaxValues<TData extends RowData>(): (
    table: Table<TData>,
    columnId: string,
  ) => () => [any, any] | undefined {
    return (_table, columnId) => {
      return () => {
        const values = this.getFacets().get(columnId);
        if (Array.isArray(values) && values.length === 2) {
          return values as [number, number];
        }
        return undefined;
      };
    };
  }

  get store(): Store<MosaicDataTableStore<TData, TValue>> {
    // We can confidently assert non-null here because the store is initialized
    // in the constructor (via updateOptions).
    return this.#store;
  }

  getFacets(): Map<string, any> {
    return this.#facetValues;
  }
}

/**
 * This is a helper Mosaic Client to query unique values for a given column.
 */
export class UniqueColumnValuesClient extends MosaicClient {
  source: MosaicTableSource;
  column: string;
  debugName?: string;
  getFilterExpressions?: () => Array<FilterExpr>;
  onResult: (values: Array<unknown>) => void;
  limit?: number;
  sortMode: FacetSortMode;
  searchTerm = '';
  private _isConnected = false;

  constructor(options: FacetClientConfig<Array<unknown>>) {
    super(options.filterBy);

    // Use || instead of checks to handle null/undefined robustly
    this.coordinator = options.coordinator || defaultCoordinator();

    // Explicitly cast to prevent "always falsy" lint error if TS types suggest it's always defined,
    // while protecting against actual runtime failures.
    if (!(this.coordinator as Coordinator | undefined)) {
      logger.error(
        'Core',
        '[UniqueColumnValuesClient] No coordinator available. Queries will fail.',
      );
    }

    this.source = options.source;
    this.column = options.column;
    this.getFilterExpressions = options.getFilterExpressions;
    this.onResult = options.onResult;
    this.limit = options.limit;
    this.sortMode = options.sortMode || 'alpha';

    this.debugName = options.__debugName;
  }

  connect(): void {
    if (this._isConnected) {
      return;
    }
    this.coordinator?.connect(this);
    this._isConnected = true;
  }

  disconnect(): void {
    this.coordinator?.disconnect(this);
    this._isConnected = false;
  }

  setSearchTerm(term: string) {
    if (this.searchTerm !== term) {
      this.searchTerm = term;
      this.requestUpdate();
    }
  }

  // Override requestQuery to safeguard against disconnected clients
  // occurring during throttled updates.
  // Updated return type to Promise<any> | null to match base class signature
  override requestQuery(query?: any): Promise<any> | null {
    if (!this.coordinator) {
      return Promise.resolve();
    }
    return super.requestQuery(query);
  }

  override query(primaryFilter?: FilterExpr | null | undefined): SelectQuery {
    let src: string | SelectQuery;
    if (typeof this.source === 'function') {
      src = this.source(primaryFilter);
    } else {
      // Unwrap if Param
      src = isParam(this.source)
        ? (this.source.value as string)
        : (this.source as string);
    }

    const statement = mSql.Query.from(src).select(this.column);
    const whereClauses: Array<mSql.FilterExpr> = [];

    if (primaryFilter && typeof this.source === 'string') {
      whereClauses.push(primaryFilter);
    }

    if (this.getFilterExpressions) {
      const internalFilters = this.getFilterExpressions();
      if (internalFilters.length > 0) {
        whereClauses.push(...internalFilters);
      }
    }

    if (this.searchTerm) {
      // Use createStructAccess to properly handle nested fields/quoting
      const colExpr = createStructAccess(this.column);
      const pattern = mSql.literal(`%${this.searchTerm}%`);
      whereClauses.push(mSql.sql`${colExpr} ILIKE ${pattern}`);
    }

    if (whereClauses.length > 0) {
      statement.where(mSql.and(...whereClauses));
    }

    statement.groupby(this.column);

    // Sort Logic
    if (this.sortMode === 'count') {
      // ORDER BY count(*) DESC
      // We descend because when filtering by frequency, the most frequent items (highest count)
      // are typically the most relevant to the user.
      statement.orderby(mSql.desc(mSql.count()));
    } else {
      // ORDER BY column ASC (default)
      statement.orderby(mSql.asc(mSql.column(this.column)));
    }

    // Limit Logic
    if (this.limit !== undefined) {
      statement.limit(this.limit);
    }

    return statement;
  }

  override queryResult(table: unknown): this {
    if (isArrowTable(table)) {
      const rows = table.toArray();
      const values: Array<unknown> = [];
      rows.forEach((row) => {
        const value = row[this.column];
        values.push(value);
      });
      this.onResult(values);
    }
    return this;
  }

  override queryError(error: Error): this {
    logger.error('Core', `${this.debugPrefix}Query Error`, { error });
    return this;
  }

  get debugPrefix(): string {
    return this.debugName ? `${this.debugName}:` : '';
  }
}

/**
 * A helper Mosaic Client to query Min and Max values for a given column.
 */
export class MinMaxColumnValuesClient extends MosaicClient {
  private source: MosaicTableSource;
  private column: string;
  debugName?: string;
  private getFilterExpressions?: () => Array<FilterExpr>;
  private onResult: (min: number, max: number) => void;
  private _isConnected = false;

  constructor(options: FacetClientConfig<[number, number]>) {
    super(options.filterBy);

    // Use || to ensure we fallback if options.coordinator is null OR undefined
    this.coordinator = options.coordinator || defaultCoordinator();

    // Explicitly cast to prevent "always falsy" lint error if TS types suggest it's always defined,
    // while protecting against actual runtime failures.
    if (!(this.coordinator as Coordinator | undefined)) {
      logger.error(
        'Core',
        '[MinMaxColumnValuesClient] No coordinator available. Queries will fail.',
      );
    }

    this.source = options.source;
    this.column = options.column;
    this.getFilterExpressions = options.getFilterExpressions;
    this.onResult = options.onResult;

    this.debugName = options.__debugName;
  }

  connect(): void {
    if (this._isConnected) {
      return;
    }
    this.coordinator?.connect(this);
    this._isConnected = true;
  }

  disconnect(): void {
    this.coordinator?.disconnect(this);
    this._isConnected = false;
  }

  // Override requestQuery to safeguard against disconnected clients
  // occurring during throttled updates.
  // Updated return type to Promise<any> | null to match base class signature
  override requestQuery(query?: any): Promise<any> | null {
    if (!this.coordinator) {
      return Promise.resolve();
    }
    return super.requestQuery(query);
  }

  override query(primaryFilter?: FilterExpr | null): SelectQuery {
    let src: string | SelectQuery;
    if (typeof this.source === 'function') {
      src = this.source(primaryFilter);
    } else {
      // Unwrap if Param
      src = isParam(this.source)
        ? (this.source.value as string)
        : (this.source as string);
    }

    const col = mSql.column(this.column);
    const statement = mSql.Query.from(src).select({
      min: mSql.min(col),
      max: mSql.max(col),
    });

    const whereClauses: Array<mSql.FilterExpr> = [];

    if (primaryFilter && typeof this.source === 'string') {
      whereClauses.push(primaryFilter);
    }

    if (this.getFilterExpressions) {
      const internal = this.getFilterExpressions();
      if (internal.length > 0) {
        whereClauses.push(...internal);
      }
    }

    if (whereClauses.length > 0) {
      statement.where(mSql.and(...whereClauses));
    }

    return statement;
  }

  override queryResult(table: unknown): this {
    if (isArrowTable(table)) {
      const rows = table.toArray();
      if (rows.length > 0) {
        const row = rows[0] as MinMaxResult;
        this.onResult(row.min, row.max);
      }
    }
    return this;
  }

  override queryError(error: Error): this {
    logger.error('Core', `${this.debugPrefix}Query Error`, { error });
    return this;
  }

  get debugPrefix(): string {
    return this.debugName ? `${this.debugName}:` : '';
  }
}
