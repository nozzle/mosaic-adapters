// packages/mosaic-tanstack-table-core/src/trimmed/data-table.ts
// This file contains the MosaicDataTable class, which acts as the "Brain" of the integration.
// It manages state, translates TanStack Table state to Mosaic queries, and handles
// filtering and faceting logic. Instrumented with detailed, debounced logging.
import {
  MosaicClient,
  coordinator as defaultCoordinator,
  isArrowTable,
  isParam,
  queryFieldInfo,
} from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import {
  sql,
  literal,
  or,
  desc,
  asc,
  count,
  column,
  isIn as sqlIn,
} from '@uwdata/mosaic-sql';
import {
  getCoreRowModel,
  getFacetedMinMaxValues,
  getFacetedRowModel,
  getFilteredRowModel,
} from '@tanstack/table-core';
import { Store, batch } from '@tanstack/store';
import {
  functionalUpdate,
  seedInitialTableState,
  toSafeSqlColumnName,
} from './utils';
import { logger } from './logger';

import type {
  FieldInfo,
  FieldInfoRequest,
  Param,
  Selection,
  SelectionClause,
} from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { ColumnDef, RowData, TableOptions } from '@tanstack/table-core';
import type { MosaicDataTableOptions, MosaicDataTableStore } from './types';

// Robust deep equality check for config objects
function isDeepEqual(obj1: any, obj2: any) {
  if (obj1 === obj2) return true;
  if (!obj1 || !obj2) return false;
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;

  if (Array.isArray(obj1)) {
    if (!Array.isArray(obj2) || obj1.length !== obj2.length) return false;
    for (let i = 0; i < obj1.length; i++) {
      if (!isDeepEqual(obj1[i], obj2[i])) return false;
    }
    return true;
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    const val1 = obj1[key];
    const val2 = obj2[key];

    if (typeof val1 === 'function' && typeof val2 === 'function') {
      if (val1.toString() !== val2.toString()) return false;
      continue;
    }

    if (
      key === 'filterBy' ||
      key === 'internalFilter' ||
      key === 'coordinator' ||
      key === 'table'
    ) {
      if (val1 !== val2) return false;
      continue;
    }

    if (!isDeepEqual(val1, val2)) return false;
  }

  return true;
}

export function createMosaicDataTableClient<
  TData extends RowData,
  TValue = unknown,
>(options: MosaicDataTableOptions<TData, TValue>) {
  return new MosaicDataTable<TData, TValue>(options);
}

export class MosaicDataTable<
  TData extends RowData,
  TValue = unknown,
> extends MosaicClient {
  from: Param<string> | string;
  schema: Array<FieldInfo> = [];

  internalFilterSelection?: Selection;

  #store!: Store<MosaicDataTableStore<TData, TValue>>;
  #sql_total_rows = toSafeSqlColumnName('__total_rows');
  #onTableStateChange: 'requestQuery' | 'requestUpdate' = 'requestUpdate';

  #columnDefIdToSqlColumnAccessor: Map<string, string> = new Map();
  #columnDefIdToFieldInfo: Map<string, FieldInfo> = new Map();
  #sqlColumnAccessorToFieldInfo: Map<string, FieldInfo> = new Map();

  constructor(options: MosaicDataTableOptions<TData, TValue>) {
    super(options.filterBy);
    this.from = options.table;

    if (!this.sourceTable()) {
      throw new Error('[MosaicDataTable] A table name must be provided.');
    }

    // Explicitly set internal filter from options on init
    if (options.internalFilter) {
      this.internalFilterSelection = options.internalFilter;
    }

    this.updateOptions(options);
  }

  // @ts-ignore
  override requestQuery(query: any): Promise<void> {
    if (!this.coordinator) return Promise.resolve();
    return super.requestQuery(query) as Promise<void>;
  }

  updateOptions(options: MosaicDataTableOptions<TData, TValue>): void {
    // Use DEBUG level (hidden from console by default)
    logger.debug('Core', 'updateOptions received', {
      newTable: options.table,
      hasColumns: !!options.columns,
      hasFilterBy: !!options.filterBy,
      columnsCount: options.columns?.length,
    });

    if (
      options.onTableStateChange &&
      this.#onTableStateChange !== options.onTableStateChange
    ) {
      this.#onTableStateChange = options.onTableStateChange;
    }

    if (
      options.internalFilter &&
      this.internalFilterSelection !== options.internalFilter
    ) {
      logger.debug('Core', 'Updating internalFilterSelection reference');
      this.internalFilterSelection = options.internalFilter;
    }

    if (!this.coordinator) {
      const coordinatorInstance = options.coordinator ?? defaultCoordinator();
      this.coordinator = coordinatorInstance;
    }

    const currentStore = this.#store?.state;

    if (currentStore) {
      const columnsChanged =
        options.columns &&
        !isDeepEqual(options.columns, currentStore.columnDefs);

      const tableOptionsChanged =
        options.tableOptions &&
        !isDeepEqual(options.tableOptions, currentStore.tableOptions);

      if (!columnsChanged && !tableOptionsChanged) {
        return;
      }
    }

    type ResolvedStore = MosaicDataTableStore<TData, TValue>;

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
        facets: new Map(),
      });
    } else {
      this.#store.setState((prev) => ({
        ...prev,
        columnDefs:
          options.columns !== undefined ? options.columns : prev.columnDefs,
        tableOptions:
          options.tableOptions !== undefined
            ? { ...prev.tableOptions, ...options.tableOptions }
            : prev.tableOptions,
      }));
    }

    // Force a map rebuild when options change to ensure we have the latest definitions
    this.getColumnsDefs();
  }

  /**
   * Generates SQL predicates from the current TanStack filter state.
   */
  private _generateFilterPredicates(): Array<mSql.FilterExpr> {
    const state = this.#store.state.tableState;
    const where: Array<mSql.FilterExpr> = [];

    // ALWAYS refresh the map to ensure we are in sync with the store
    this.getColumnsDefs();

    const createPredicate = (id: string, value: any) => {
      const sqlColumnName = this.#columnDefIdToSqlColumnAccessor.get(id);

      if (!sqlColumnName) {
        logger.warn('Core', `Filter ignored: No SQL column found`, {
          columnId: id,
          availableIds: Array.from(this.#columnDefIdToSqlColumnAccessor.keys()),
        });
        return null;
      }

      const sqlCol = column(sqlColumnName);

      if (Array.isArray(value) && value.length > 0) {
        const options = value.map((v) => literal(v));
        return sqlIn(sqlCol, options);
      }

      // Default string matching
      return sql`CAST(${sqlCol} AS VARCHAR) ILIKE ${literal(`%${value}%`)}`;
    };

    for (const f of state.columnFilters) {
      if (f.value != null && f.value !== '') {
        const predicate = createPredicate(f.id, f.value);
        if (predicate) where.push(predicate);
      }
    }

    if (state.globalFilter) {
      const globalPredicates: Array<mSql.FilterExpr> = [];
      this.#columnDefIdToSqlColumnAccessor.forEach((_, id) => {
        const predicate = createPredicate(id, state.globalFilter);
        if (predicate) globalPredicates.push(predicate);
      });

      if (globalPredicates.length > 0) {
        where.push(or(...globalPredicates));
      }
    }

    return where;
  }

  override query(primaryFilter?: FilterExpr | null | undefined): SelectQuery {
    const tableName = this.sourceTable();
    const tableState = this.#store.state.tableState;
    const pagination = tableState.pagination;

    // Refresh column mappings
    this.getColumnsDefs();

    const sorting = tableState.sorting.filter((sort) =>
      this.#columnDefIdToSqlColumnAccessor.has(sort.id),
    );

    const tableColumns = this.sqlColumns();

    const statement = mSql.Query.from(tableName).select(...tableColumns, {
      [this.#sql_total_rows]: mSql.sql`COUNT(*) OVER()`,
    });

    const whereClauses: Array<mSql.FilterExpr> = [];

    // 1. Add External Filter (from filterBy / Top Widgets)
    if (primaryFilter) {
      whereClauses.push(primaryFilter);
    }

    // 2. Add Internal Filter (from table columns)
    const internalFilters = this._generateFilterPredicates();
    if (internalFilters.length > 0) {
      whereClauses.push(...internalFilters);
    }

    statement.where(...whereClauses);

    const orderingCriteria: Array<mSql.OrderByNode> = [];
    sorting.forEach((sort) => {
      const columnAccessor = this.#columnDefIdToSqlColumnAccessor.get(sort.id)!;
      const colExpr = column(columnAccessor);
      orderingCriteria.push(sort.desc ? desc(colExpr) : asc(colExpr));
    });

    statement.orderby(...orderingCriteria);
    statement
      .limit(pagination.pageSize)
      .offset(pagination.pageIndex * pagination.pageSize);

    const sqlString = statement.toString();

    // Use the debounced logger for the query execution.
    // This prevents log flooding when dragging a brush over a linked chart.
    // We only capture the "final" query of the interaction sequence.
    logger.debounce('sql-query', 300, 'info', 'SQL', 'Generated Query', {
      sql: sqlString,
      context: {
        pagination: tableState.pagination,
        sorting: tableState.sorting,
        columnFilters: tableState.columnFilters,
        globalFilter: tableState.globalFilter,
        // Extract a readable string from the primary filter AST if possible
        primaryFilter: primaryFilter
          ? primaryFilter.toString()
          : 'None (or null)',
      },
    });

    return statement;
  }

  override queryResult(table: unknown): this {
    if (isArrowTable(table)) {
      let totalRows: number | undefined = undefined;
      const rows = table.toArray() as Array<TData>;

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
          return { ...prev, rows, totalRows };
        });
      });
    } else {
      logger.error('Core', 'Received non-Arrow result:', { table });
    }
    return this;
  }

  public async loadColumnFacet(columnId: string) {
    if (this.#columnDefIdToSqlColumnAccessor.size === 0) {
      this.getColumnsDefs();
    }
    const sqlColumnName = this.#columnDefIdToSqlColumnAccessor.get(columnId);
    if (!sqlColumnName) return;
    const sqlCol = column(sqlColumnName);
    const query = mSql.Query.from(this.sourceTable())
      .select({ value: sqlCol, count: count() })
      .groupby(sqlCol)
      .orderby(desc('count'))
      .where(this.filterBy?.predicate(this) || []);
    try {
      if (!this.coordinator) return;
      const result = await this.coordinator.query(query);
      const facetMap = new Map<any, number>();
      for (const row of result) facetMap.set(row.value, row.count);
      this.#store.setState((prev) => {
        const newFacets = new Map(prev.facets);
        newFacets.set(columnId, facetMap);
        return { ...prev, facets: newFacets };
      });
    } catch (e) {
      logger.error('Core', `Failed to load facet for ${columnId}`, {
        error: e,
      });
    }
  }

  override queryPending(): this {
    return this;
  }
  override queryError(error: Error): this {
    logger.error('Core', 'Query Error', { error });
    return this;
  }
  override async prepare(): Promise<void> {
    if (!this.coordinator) return;
    const schema = await queryFieldInfo(this.coordinator, this.fields());
    this.schema = schema;
    this.#columnDefIdToFieldInfo.clear();
    this.#sqlColumnAccessorToFieldInfo.clear();
    const map = new Map<string, FieldInfo>();
    schema.forEach((field) => map.set(field.column, field));
    this.#sqlColumnAccessorToFieldInfo = map;
    Array.from(this.#columnDefIdToSqlColumnAccessor.entries()).forEach(
      ([id, value]) => {
        const matchedField = map.get(value);
        if (!matchedField) {
          logger.warn(
            'Core',
            `Column ID "${id}" mapped to SQL "${value}" which does not exist in schema.`,
          );
        } else {
          this.#columnDefIdToFieldInfo.set(id, matchedField);
        }
      },
    );
    return Promise.resolve();
  }

  connect(): () => void {
    if (!this.coordinator) this.coordinator = defaultCoordinator();
    this.coordinator.connect(this);
    this.enabled = true;
    const destroy = this.destroy.bind(this);
    const selectionCb = (_: Array<SelectionClause> | undefined) => {
      batch(() => {
        this.#store.setState((prev) => ({
          ...prev,
          tableState: {
            ...prev.tableState,
            pagination: { ...prev.tableState.pagination, pageIndex: 0 },
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
  }

  private sqlColumns(): Array<mSql.SelectExpr> {
    const selectColumns = this.fields().map((d) =>
      typeof d.column !== 'string' ? d.column.toString() : d.column,
    );
    return [selectColumns];
  }

  sourceTable(): string {
    return (isParam(this.from) ? this.from.value : this.from) as string;
  }

  private getColumnsDefs() {
    // Safety check
    if (!this.#store || !this.#store.state) {
      logger.warn('Core', 'getColumnsDefs called before store initialized');
      return {
        columnDefs: [],
        columnAccessorKeys: [],
        shouldSearchAllColumns: false,
      };
    }

    const columnDefs = this.#store.state.columnDefs;
    this.#columnDefIdToSqlColumnAccessor.clear();

    const queryableColumns = columnDefs.filter((def) => {
      if (
        'accessorKey' in def &&
        typeof def.accessorKey === 'string' &&
        def.accessorKey.length > 0
      )
        return true;
      if ('accessorFn' in def && typeof def.accessorFn === 'function')
        return true;
      return false;
    });

    let shouldSearchAllColumns = queryableColumns.length === 0;
    let columnAccessorKeys: Array<string> = [];

    queryableColumns.forEach((def) => {
      let columnAccessor: string | undefined = undefined;
      // 1. Try Accessor Key
      if ('accessorKey' in def && def.accessorKey) {
        const accessor =
          typeof def.accessorKey === 'string'
            ? def.accessorKey
            : def.accessorKey.toString();
        columnAccessorKeys.push(accessor);
        columnAccessor = accessor;
      }
      // 2. Try Accessor Fn + SQL Column Meta
      else if ('accessorFn' in def && typeof def.accessorFn === 'function') {
        if (def.meta?.mosaicDataTable?.sqlColumn) {
          const mosaicColumn = def.meta.mosaicDataTable.sqlColumn;
          columnAccessorKeys.push(mosaicColumn);
          columnAccessor = mosaicColumn;
        } else {
          // This is valid for non-sql columns (like actions), but we shouldn't try to query them
        }
      }

      // Ensure we map the ID correctly
      if (columnAccessor) {
        // Fallback: If ID is missing (TanStack generates one at runtime, but we operate on definitions), try to use accessor
        const id = def.id ?? columnAccessor;
        this.#columnDefIdToSqlColumnAccessor.set(id, columnAccessor);
      }
    });

    if (shouldSearchAllColumns) columnAccessorKeys = [];

    return {
      columnDefs: queryableColumns,
      columnAccessorKeys,
      shouldSearchAllColumns,
    };
  }

  fields(): Array<FieldInfoRequest> {
    const table = this.sourceTable();
    const result = this.getColumnsDefs();
    const { shouldSearchAllColumns, columnAccessorKeys } = result;
    return shouldSearchAllColumns
      ? [{ table, column: '*' }]
      : columnAccessorKeys.map((accessor) => ({ table, column: accessor }));
  }

  getTableOptions(
    state: Store<MosaicDataTableStore<TData, TValue>>['state'],
  ): TableOptions<TData> {
    const columns =
      state.columnDefs.length === 0
        ? this.schema.map(
            (field) =>
              ({
                accessorKey: field.column,
                header: field.column,
              }) satisfies ColumnDef<TData, TValue>,
          )
        : state.columnDefs.map(
            (column) => column satisfies ColumnDef<TData, TValue>,
          );

    return {
      data: state.rows,
      columns,
      getCoreRowModel: getCoreRowModel(),
      getFacetedRowModel: getFacetedRowModel(),
      getFilteredRowModel: getFilteredRowModel(),
      getFacetedUniqueValues: (table, columnId) => () =>
        state.facets.get(columnId) || new Map(),
      getFacetedMinMaxValues: getFacetedMinMaxValues(),
      state: state.tableState,
      onStateChange: (updater) => {
        const oldState = this.#store.state.tableState;
        const nextTableState = functionalUpdate(updater, oldState);

        // Calculate explicit diffs for the log file
        const diffs: Record<string, any> = {};
        if (
          JSON.stringify(oldState.pagination) !==
          JSON.stringify(nextTableState.pagination)
        ) {
          diffs.pagination = {
            from: oldState.pagination,
            to: nextTableState.pagination,
          };
        }
        if (
          JSON.stringify(oldState.sorting) !==
          JSON.stringify(nextTableState.sorting)
        ) {
          diffs.sorting = {
            from: oldState.sorting,
            to: nextTableState.sorting,
          };
        }
        if (
          JSON.stringify(oldState.columnFilters) !==
          JSON.stringify(nextTableState.columnFilters)
        ) {
          diffs.filters = {
            from: oldState.columnFilters,
            to: nextTableState.columnFilters,
          };
        }

        // Log the state transition
        // Use debounce for state transitions to avoid flood during rapid interactions if they trigger state
        if (Object.keys(diffs).length > 0) {
          logger.debounce(
            'state-update',
            300,
            'debug',
            'TanStack',
            'State Update Detected',
            { diffs },
          );
        }

        const filtersChanged =
          JSON.stringify(oldState.columnFilters) !==
            JSON.stringify(nextTableState.columnFilters) ||
          oldState.globalFilter !== nextTableState.globalFilter;

        if (filtersChanged) {
          logger.debug('Core', 'Filters changed:', {
            filters: nextTableState.columnFilters,
          });
          nextTableState.pagination.pageIndex = 0;
        }

        const hashedOldState = JSON.stringify(oldState);
        const hashedNewState = JSON.stringify(nextTableState);

        this.#store.setState((prev) => ({
          ...prev,
          tableState: nextTableState,
        }));

        if (filtersChanged) {
          if (this.internalFilterSelection) {
            const predicates = this._generateFilterPredicates();
            const combinedPredicate =
              predicates.length > 0 ? mSql.and(...predicates) : null;

            logger.debug('Core', 'Updating internalFilterSelection');

            this.internalFilterSelection.update({
              source: this,
              predicate: combinedPredicate,
              value: {
                columnFilters: nextTableState.columnFilters,
                globalFilter: nextTableState.globalFilter,
              },
            });
          } else {
            logger.warn(
              'Core',
              'Filters changed but no internalFilterSelection is configured!',
            );
          }
        }

        if (hashedOldState !== hashedNewState) {
          if (typeof this[this.#onTableStateChange] === 'function') {
            // @ts-ignore
            this[this.#onTableStateChange]();
          }
        }
      },
      manualPagination: true,
      manualSorting: true,
      manualFiltering: true,
      rowCount: state.totalRows,
      ...state.tableOptions,
    };
  }

  get store(): Store<MosaicDataTableStore<TData, TValue>> {
    return this.#store;
  }
}