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
  functionalUpdate,
  seedInitialTableState,
  toSafeSqlColumnName,
} from './utils';
import { logger } from './logger';
import { ColumnMapper } from './query/column-mapper';
import { buildTableQuery, extractInternalFilters } from './query/query-builder';

import type {
  Coordinator,
  FieldInfo,
  FieldInfoRequest,
  SelectionClause,
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
  disconnect: () => void;
}

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

  // DO NOT remove the `!` here. We guarantee initialization in updateOptions which is also called by the constructor.
  #store!: Store<MosaicDataTableStore<TData, TValue>>;
  #sql_total_rows = toSafeSqlColumnName('__total_rows');
  #onTableStateChange: 'requestQuery' | 'requestUpdate' = 'requestUpdate';

  // The Mapper handles all ColumnDef <-> SQL Column logic
  #columnMapper!: ColumnMapper<TData, TValue>;

  // Registry to track active facet sidecar clients.
  #facetClients: Map<string, ActiveFacetClient> = new Map();
  #facetValues: Map<string, any> = new Map();

  constructor(options: MosaicDataTableOptions<TData, TValue>) {
    super(options.filterBy); // pass the appropriate Filter Selection

    this.source = options.table;

    this.updateOptions(options);
  }

  /**
   * When options are updated from framework-land, we need to update
   * the internal store and state accordingly.
   * @param options The updated options from framework-land.
   */
  updateOptions(options: MosaicDataTableOptions<TData, TValue>): void {
    logger.debug('Core', 'updateOptions received', {
      source: typeof options.table === 'string' ? options.table : 'function',
      columnsCount: options.columns?.length,
    });

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
    }
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
    const source = this.resolveSource(primaryFilter);
    // Force unwrap here since we guarantee initialization in updateOptions/constructor
    const tableState = this.#store.state.tableState;

    // 1. Delegate Query Building
    // The QueryBuilder handles Columns, Pagination, Sorting, and Internal Filters
    const statement = buildTableQuery({
      source,
      tableState,
      mapper: this.#columnMapper,
      totalRowsColumnName: this.#sql_total_rows,
    });

    // 2. Apply Primary Filter (Global/External Context)
    // If source is a string, we apply the filter here.
    // If source is a Query object, the Factory likely already applied it, or we append it.
    if (primaryFilter && typeof this.source === 'string') {
      statement.where(primaryFilter);
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

  override queryError(error: Error): this {
    logger.error('Core', 'Query Error', { error });
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

    const destroy = this.destroy.bind(this);

    // Setup the primary selection change listener to reset pagination
    const selectionCb = (_: Array<SelectionClause> | undefined) => {
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
    };
    this.filterBy?.addEventListener('value', selectionCb);

    return () => {
      this.filterBy?.removeEventListener('value', selectionCb);
      destroy();
    };
  }

  destroy(): void {
    super.destroy();
    this.#facetClients.forEach((client) => client.disconnect());
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
      // Default behavior for internal table facets is alpha sort, no limit (for now)
      // Users can override this by implementing manual sidecars if they need high-cardinality protection
      sort: 'alpha',
    });

    this.#facetClients.set(clientKey, facetClient);
    facetClient.connect();
    facetClient.requestUpdate();
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
    });

    this.#facetClients.set(clientKey, facetClient);
    facetClient.connect();
    facetClient.requestUpdate();
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
  getFilterExpressions?: () => Array<FilterExpr>;
  onResult: (values: Array<unknown>) => void;
  limit?: number;
  sort: 'alpha' | 'count';

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
    this.sort = options.sort || 'alpha';
  }

  connect(): void {
    this.coordinator?.connect(this);
  }

  disconnect(): void {
    this.coordinator?.disconnect(this);
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

    if (whereClauses.length > 0) {
      statement.where(mSql.and(...whereClauses));
    }

    statement.groupby(this.column);

    // Sort Logic
    if (this.sort === 'count') {
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
}

/**
 * A helper Mosaic Client to query Min and Max values for a given column.
 */
export class MinMaxColumnValuesClient extends MosaicClient {
  private source: MosaicTableSource;
  private column: string;
  private getFilterExpressions?: () => Array<FilterExpr>;
  private onResult: (min: number, max: number) => void;

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
  }

  connect(): void {
    this.coordinator?.connect(this);
  }

  disconnect(): void {
    this.coordinator?.disconnect(this);
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
        const row = rows[0] as any;
        this.onResult(row.min, row.max);
      }
    }
    return this;
  }
}