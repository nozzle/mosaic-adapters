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
  Param,
  SelectionClause,
} from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  ColumnDef,
  RowData,
  Table,
  TableOptions,
} from '@tanstack/table-core';
import type { MosaicDataTableOptions, MosaicDataTableStore } from './types';

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
 *
 * REFACTOR NOTE: This class now acts as an Orchestrator. The heavy lifting of
 * Schema Mapping and Query Generation has been moved to `query/ColumnMapper`
 * and `query/QueryBuilder`.
 */
export class MosaicDataTable<
  TData extends RowData,
  TValue = unknown,
> extends MosaicClient {
  from: Param<string> | string;
  schema: Array<FieldInfo> = [];
  tableFilterSelection!: Selection;

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

    this.from = options.table;

    if (!this.sourceTable()) {
      throw new Error('[MosaicDataTable] A table name must be provided.');
    }

    this.updateOptions(options);
  }

  /**
   * When options are updated from framework-land, we need to update
   * the internal store and state accordingly.
   * @param options The updated options from framework-land.
   */
  updateOptions(options: MosaicDataTableOptions<TData, TValue>): void {
    logger.debug('Core', 'updateOptions received', {
      newTable: options.table,
      columnsCount: options.columns?.length,
    });

    if (options.onTableStateChange) {
      this.#onTableStateChange = options.onTableStateChange;
    }

    if (options.tableFilterSelection) {
      this.tableFilterSelection = options.tableFilterSelection;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (!this.tableFilterSelection) {
      this.tableFilterSelection = new Selection();
    }

    // Ensure we have a coordinator assigned
    if (!this.coordinator) {
      const coordinatorInstance = options.coordinator ?? defaultCoordinator();
      this.coordinator = coordinatorInstance;
    }

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

  override query(primaryFilter?: FilterExpr | null | undefined): SelectQuery {
    const tableName = this.sourceTable();
    const tableState = this.#store.state.tableState;

    // 1. Delegate Query Building
    // The QueryBuilder handles Columns, Pagination, Sorting, and Internal Filters
    const statement = buildTableQuery({
      tableName,
      tableState,
      mapper: this.#columnMapper,
      totalRowsColumnName: this.#sql_total_rows,
    });

    // 2. Apply Primary Filter (Global/External Context)
    if (primaryFilter) {
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
    // Now fields() uses the mapper
    const schema = await queryFieldInfo(this.coordinator!, this.fields());
    this.schema = schema;
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
    if (!sqlColumn) return;

    const clientKey = `${columnId}:unique`;
    if (this.#facetClients.has(clientKey)) return;

    const facetClient = new UniqueColumnValuesClient({
      table: this.sourceTable(),
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
    if (!sqlColumn) return;

    const clientKey = `${columnId}:minmax`;
    if (this.#facetClients.has(clientKey)) return;

    const facetClient = new MinMaxColumnValuesClient({
      table: this.sourceTable(),
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
   * Resolve the table name.
   */
  sourceTable(): string {
    return (isParam(this.from) ? this.from.value : this.from) as string;
  }

  /**
   * Map TanStack Table's ColumnDefs to Mosaic FieldInfoRequests.
   */
  fields(): Array<FieldInfoRequest> {
    const table = this.sourceTable();
    // Use the Mapper logic
    return this.#columnMapper.getMosaicFieldRequests(table);
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
        if (!values) return new Map<any, number>();
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
    return this.#store;
  }

  getFacets(): Map<string, any> {
    return this.#facetValues;
  }
}

type FacetClientConfig<TResult extends Array<any>> = {
  filterBy?: Selection;
  coordinator?: Coordinator | null;
  table: string;
  column: string;
  getFilterExpressions?: () => Array<mSql.FilterExpr>;
  onResult: (...values: TResult) => void;
};

/**
 * This is a helper Mosaic Client to query unique values for a given column.
 */
export class UniqueColumnValuesClient extends MosaicClient {
  from: string;
  column: string;
  getFilterExpressions?: () => Array<mSql.FilterExpr>;
  onResult: (values: Array<unknown>) => void;

  constructor(options: FacetClientConfig<Array<unknown>>) {
    super(options.filterBy);

    if (options.coordinator) {
      this.coordinator = options.coordinator;
    } else {
      this.coordinator = defaultCoordinator();
    }

    this.from = options.table;
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

  override query(primaryFilter?: FilterExpr | null | undefined): SelectQuery {
    const statement = mSql.Query.from(this.from).select(this.column);
    const whereClauses: Array<mSql.FilterExpr> = [];

    if (primaryFilter) {
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
    statement.orderby(mSql.asc(mSql.column(this.column)));

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
  private from: string;
  private column: string;
  private getFilterExpressions?: () => Array<mSql.FilterExpr>;
  private onResult: (min: number, max: number) => void;

  constructor(options: FacetClientConfig<[number, number]>) {
    super(options.filterBy);
    this.coordinator = options.coordinator ?? defaultCoordinator();
    this.from = options.table;
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

  override query(primaryFilter?: FilterExpr | null): SelectQuery {
    const col = mSql.column(this.column);
    const statement = mSql.Query.from(this.from).select({
      min: mSql.min(col),
      max: mSql.max(col),
    });

    const whereClauses: Array<mSql.FilterExpr> = [];

    if (primaryFilter) {
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

    logger.debug('Core', `[MinMax] Generated Query for ${this.column}`, {
      sql: statement.toString(),
    });

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
