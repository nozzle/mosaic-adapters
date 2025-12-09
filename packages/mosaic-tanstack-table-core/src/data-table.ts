/**
 * The core Orchestrator for the Mosaic <-> TanStack Table integration.
 * Manages state, schema mapping, query generation, and facet sidecars.
 */

import {
  MosaicClient,
  Selection,
  coordinator as defaultCoordinator,
  isArrowTable,
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
  MosaicDataTableOptions,
  MosaicDataTableStore,
  MosaicTableSource,
} from './types';

export function createMosaicDataTableClient<
  TData extends RowData,
  TValue = unknown,
>(options: MosaicDataTableOptions<TData, TValue>) {
  const client = new MosaicDataTable<TData, TValue>(options);
  return client;
}

interface ActiveFacetClient extends MosaicClient {
  disconnect: () => void;
  requestUpdate: () => void;
}

export class MosaicDataTable<
  TData extends RowData,
  TValue = unknown,
> extends MosaicClient {
  source: MosaicTableSource;
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
    super(options.filterBy);

    this.source = options.table;

    this.updateOptions(options);
  }

  updateOptions(options: MosaicDataTableOptions<TData, TValue>): void {
    logger.debug('Core', 'updateOptions received', {
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

    if (!this.coordinator) {
      const coordinatorInstance = options.coordinator ?? defaultCoordinator();
      this.coordinator = coordinatorInstance;
    }

    type ResolvedStore = MosaicDataTableStore<TData, TValue>;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!this.#store) {
      // Explicitly type the Store to ensure _lastFilterSignature is string | undefined, not just undefined
      this.#store = new Store<ResolvedStore>({
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
        _lastFilterSignature: undefined,
      });
    } else {
      this.#store.setState((prev) => ({
        ...prev,
        columnDefs:
          options.columns !== undefined ? options.columns : prev.columnDefs,
      }));
    }

    if (options.columns) {
      this.#columnMapper = new ColumnMapper(options.columns);
    }
  }

  resolveSource(filter?: FilterExpr | null): string | SelectQuery {
    if (typeof this.source === 'function') {
      return this.source(filter);
    }
    return this.source;
  }

  /**
   * Generates a signature of the current filtering state.
   * This includes external filters (filterBy) and internal table filters.
   */
  private generateFilterSignature(
    primaryFilter?: FilterExpr | null,
  ): string | undefined {
    // We need to capture everything that affects the Row Count.
    // 1. Primary Filter (external)
    const primarySig = primaryFilter ? primaryFilter.toString() : 'null';

    // 2. Internal Filters (column filters)
    // We can use the tableState directly
    const internalFilters = this.#store.state.tableState.columnFilters;
    const internalSig = JSON.stringify(internalFilters);

    return `${primarySig}::${internalSig}`;
  }

  override query(primaryFilter?: FilterExpr | null | undefined): SelectQuery {
    // 1. Resolve Source
    const source = this.resolveSource(primaryFilter);
    const tableState = this.#store.state.tableState;

    // 2. Smart Counting Logic
    // We compare the current filter signature with the previous one.
    // If they match, and we already have a total row count, we can skip the COUNT(*) OVER() overhead.
    const currentFilterSignature = this.generateFilterSignature(primaryFilter);
    const lastSignature = this.#store.state._lastFilterSignature;
    const hasTotalRows = this.#store.state.totalRows !== undefined;

    // Optimization: Skip count if filters haven't changed and we have a count
    const shouldRecalculateCount =
      !hasTotalRows || currentFilterSignature !== lastSignature;

    // If we skip recalculation, update the store to confirm the signature remains valid
    if (!shouldRecalculateCount) {
      logger.info('Core', 'Smart Count Optimization: Skipping COUNT(*) OVER()');
    }

    // 3. Delegate Query Building
    const statement = buildTableQuery({
      source,
      tableState,
      mapper: this.#columnMapper,
      totalRowsColumnName: this.#sql_total_rows,
      includeTotalCount: shouldRecalculateCount,
    });

    // 4. Apply Primary Filter (Conditional)
    if (primaryFilter && typeof this.source === 'string') {
      statement.where(primaryFilter);
    }

    // 5. Side Effect: Update Internal Filter Selection
    const internalClauses = extractInternalFilters({
      tableState,
      mapper: this.#columnMapper,
    });

    const predicate =
      internalClauses.length > 0 ? mSql.and(...internalClauses) : null;

    this.tableFilterSelection.update({
      source: this,
      value: tableState.columnFilters,
      predicate: predicate,
    });

    // 6. Persist the signature for next time
    // We update the store signature NOW, so the next query knows.
    if (shouldRecalculateCount) {
      batch(() => {
        this.#store.setState((prev) => ({
          ...prev,
          _lastFilterSignature: currentFilterSignature,
        }));
      });
    }

    return statement;
  }

  public getCascadingFilters(options: {
    excludeColumnId: string;
  }): Array<mSql.FilterExpr> {
    const tableState = this.#store.state.tableState;

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
      const rows = table.toArray() as Array<TData>;

      // 1. Try to get Total Rows from the current result set
      if (
        rows.length > 0 &&
        rows[0] &&
        typeof rows[0] === 'object' &&
        this.#sql_total_rows in rows[0]
      ) {
        const firstRow = rows[0] as Record<string, any>;
        totalRows = firstRow[this.#sql_total_rows];
      }

      // 2. Fallback: If optimization was triggered, the column is missing.
      // We retain the existing totalRows from the store.
      if (totalRows === undefined) {
        totalRows = this.#store.state.totalRows;
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
    const source = this.resolveSource();
    if (typeof source === 'string') {
      const schema = await queryFieldInfo(this.coordinator!, this.fields());
      this.schema = schema;
    }
    return Promise.resolve();
  }

  connect(): () => void {
    this.coordinator?.connect(this);
    this.enabled = true;

    const destroy = this.destroy.bind(this);

    const selectionCb = (_: Array<SelectionClause> | undefined) => {
      this.requestUpdate();

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

  loadColumnFacet(columnId: string) {
    const sqlColumn = this.#columnMapper.getSqlColumn(columnId);
    if (!sqlColumn) return;

    const clientKey = `${columnId}:unique`;
    if (this.#facetClients.has(clientKey)) return;

    const facetClient = new UniqueColumnValuesClient({
      source: this.source,
      column: sqlColumn,
      filterBy: this.filterBy,
      coordinator: this.coordinator,
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

  loadColumnMinMax(columnId: string) {
    const sqlColumn = this.#columnMapper.getSqlColumn(columnId);
    if (!sqlColumn) return;

    const clientKey = `${columnId}:minmax`;
    if (this.#facetClients.has(clientKey)) return;

    const facetClient = new MinMaxColumnValuesClient({
      source: this.source,
      column: sqlColumn,
      filterBy: this.filterBy,
      coordinator: this.coordinator,
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

  fields(): Array<FieldInfoRequest> {
    const source = this.resolveSource();
    if (typeof source !== 'string') {
      return [];
    }
    return this.#columnMapper.getMosaicFieldRequests(source);
  }

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

          logger.info('Core', 'StateChange', tableState);

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
    return this.#store;
  }

  getFacets(): Map<string, any> {
    return this.#facetValues;
  }
}

type FacetClientConfig<TResult extends Array<any>> = {
  filterBy?: Selection;
  coordinator?: Coordinator | null;
  source: MosaicTableSource;
  column: string;
  getFilterExpressions?: () => Array<mSql.FilterExpr>;
  onResult: (...values: TResult) => void;
};

export class UniqueColumnValuesClient extends MosaicClient {
  source: MosaicTableSource;
  column: string;
  getFilterExpressions?: () => Array<mSql.FilterExpr>;
  onResult: (values: Array<unknown>) => void;
  lastQuerySql?: string; // Cache for deduping

  constructor(options: FacetClientConfig<Array<unknown>>) {
    super(options.filterBy);
    this.coordinator = options.coordinator ?? defaultCoordinator();
    this.source = options.source;
    this.column = options.column;
    this.getFilterExpressions = options.getFilterExpressions;
    this.onResult = options.onResult;
  }

  connect(): void {
    if (!this.coordinator) {
      this.coordinator = defaultCoordinator();
    }
    this.coordinator?.connect(this);
  }

  disconnect(): void {
    this.coordinator?.disconnect(this);
  }

  override requestQuery(query?: any) {
    // Optimization: Dedupe query generation
    if (!query) {
      // If we are requesting a generic update (no explicit query override),
      // verify if the generated SQL is different from the last run.
      // We have to simulate the query generation to check.
      const predicate = this.filterBy ? this.filterBy.predicate(this) : null;
      const nextQuery = this.query(predicate);
      const nextSql = nextQuery.toString();

      if (this.lastQuerySql === nextSql) {
        // No change, skip the roundtrip
        // return resolved promise
        return Promise.resolve(this);
      }
      this.lastQuerySql = nextSql;
    }

    if (!this.coordinator) {
      return Promise.resolve(this);
    }
    return super.requestQuery(query);
  }

  override query(primaryFilter?: FilterExpr | null | undefined): SelectQuery {
    let src: string | SelectQuery;
    if (typeof this.source === 'function') {
      src = this.source(primaryFilter);
    } else {
      src = this.source;
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

export class MinMaxColumnValuesClient extends MosaicClient {
  private source: MosaicTableSource;
  private column: string;
  private getFilterExpressions?: () => Array<mSql.FilterExpr>;
  private onResult: (min: number, max: number) => void;
  private lastQuerySql?: string;

  constructor(options: FacetClientConfig<[number, number]>) {
    super(options.filterBy);
    this.coordinator = options.coordinator ?? defaultCoordinator();
    this.source = options.source;
    this.column = options.column;
    this.getFilterExpressions = options.getFilterExpressions;
    this.onResult = options.onResult;
  }

  connect(): void {
    if (!this.coordinator) {
      this.coordinator = defaultCoordinator();
    }
    this.coordinator?.connect(this);
  }

  disconnect(): void {
    this.coordinator?.disconnect(this);
  }

  override requestQuery(query?: any) {
    if (!query) {
      const predicate = this.filterBy ? this.filterBy.predicate(this) : null;
      const nextQuery = this.query(predicate);
      const nextSql = nextQuery.toString();

      if (this.lastQuerySql === nextSql) {
        return Promise.resolve(this);
      }
      this.lastQuerySql = nextSql;
    }

    if (!this.coordinator) {
      return Promise.resolve(this);
    }
    return super.requestQuery(query);
  }

  override query(primaryFilter?: FilterExpr | null): SelectQuery {
    let src: string | SelectQuery;
    if (typeof this.source === 'function') {
      src = this.source(primaryFilter);
    } else {
      src = this.source;
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