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
  eq,
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
import type {
  MosaicDataTableColumnDefMetaOptions,
  MosaicDataTableOptions,
  MosaicDataTableStore,
} from './types';

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
      key === 'table' ||
      key === 'hoverAs' ||
      key === 'clickAs'
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
  hoverAs?: Selection;
  clickAs?: Selection;
  primaryKey: string[] = ['id']; // Default PK

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

    if (options.internalFilter) {
      this.internalFilterSelection = options.internalFilter;
    }

    // Initialize hover/click selections
    if (options.hoverAs) this.hoverAs = options.hoverAs;
    if (options.clickAs) this.clickAs = options.clickAs;

    // Set Primary Key if provided (crucial for row identification)
    if (options.primaryKey) this.primaryKey = options.primaryKey;

    this.updateOptions(options);
  }

  // @ts-ignore
  override requestQuery(query: any): Promise<void> {
    if (!this.coordinator) return Promise.resolve();
    return super.requestQuery(query) as Promise<void>;
  }

  updateOptions(options: MosaicDataTableOptions<TData, TValue>): void {
    logger.debug('Core', 'updateOptions received', {
      newTable: options.table,
      columnsCount: options.columns?.length,
    });

    if (
      options.onTableStateChange &&
      this.#onTableStateChange !== options.onTableStateChange
    ) {
      this.#onTableStateChange = options.onTableStateChange;
    }

    if (options.internalFilter)
      this.internalFilterSelection = options.internalFilter;
    if (options.hoverAs) this.hoverAs = options.hoverAs;
    if (options.clickAs) this.clickAs = options.clickAs;
    if (options.primaryKey) this.primaryKey = options.primaryKey;

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
        facetMinMax: new Map(),
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

    this.getColumnsDefs();
  }

  private _generateFilterPredicates(): Array<mSql.FilterExpr> {
    const state = this.#store.state.tableState;
    const where: Array<mSql.FilterExpr> = [];
    this.getColumnsDefs();

    const getColMeta = (id: string) => {
      const colDef = this.#store.state.columnDefs.find(
        (c) => c.id === id || ('accessorKey' in c && c.accessorKey === id),
      );
      // @ts-ignore
      return (colDef?.meta as MosaicDataTableColumnDefMetaOptions | undefined)
        ?.mosaicDataTable;
    };

    const createPredicate = (id: string, value: any) => {
      const sqlColumnName = this.#columnDefIdToSqlColumnAccessor.get(id);
      if (!sqlColumnName) return null;

      const sqlCol = column(sqlColumnName);
      const meta = getColMeta(id);
      const filterType = meta?.sqlFilterType || 'ilike';

      if (filterType === 'range' && Array.isArray(value)) {
        const [min, max] = value;
        const clauses = [];
        if (min !== null && min !== '' && min !== undefined)
          clauses.push(mSql.gte(sqlCol, literal(min)));
        if (max !== null && max !== '' && max !== undefined)
          clauses.push(mSql.lte(sqlCol, literal(max)));
        return clauses.length > 0 ? mSql.and(...clauses) : null;
      }

      if (filterType === 'in' && Array.isArray(value)) {
        if (value.length === 0) return null;
        return sqlIn(
          sqlCol,
          value.map((v) => literal(v)),
        );
      }

      if (filterType === 'equals') {
        return mSql.eq(sqlCol, literal(value));
      }

      if (filterType === 'like') {
        return sql`CAST(${sqlCol} AS VARCHAR) LIKE ${literal(`%${value}%`)}`;
      }

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
        const meta = getColMeta(id);
        if (
          !meta?.sqlFilterType ||
          meta.sqlFilterType === 'ilike' ||
          meta.sqlFilterType === 'like'
        ) {
          const predicate = createPredicate(id, state.globalFilter);
          if (predicate) globalPredicates.push(predicate);
        }
      });
      if (globalPredicates.length > 0) {
        where.push(or(...globalPredicates));
      }
    }

    return where;
  }

  /**
   * Handles interaction events (Hover/Click) on a row.
   * Generates a predicate based on the Primary Key (e.g. ID = 5) and updates the target selection.
   */
  private handleRowInteraction(
    row: TData | null,
    selection: Selection | undefined,
    type: 'hover' | 'click',
  ) {
    if (!selection) return;

    // Case 1: Mouse Leave or Clear -> Update with NULL predicate
    // This is crucial for { empty: true } selections to reset to "Select None"
    if (!row) {
      selection.update({
        source: this,
        // @ts-ignore - Mosaic API allows null predicate to clear
        predicate: null,
        value: null,
      });
      return;
    }

    // Case 2: Interaction -> Generate PK Predicate
    // We assume the row object contains the keys defined in this.primaryKey
    const predicates: any[] = [];

    for (const key of this.primaryKey) {
      if (typeof row === 'object' && row !== null && key in row) {
        // @ts-ignore
        const val = row[key];
        // We use simple equality for PKs
        predicates.push(eq(column(key), literal(val)));
      } else {
        logger.warn(
          'Core',
          `Primary key "${key}" not found in row data during ${type} interaction.`,
          { row },
        );
      }
    }

    if (predicates.length > 0) {
      selection.update({
        source: this,
        predicate:
          predicates.length === 1 ? predicates[0] : mSql.and(...predicates),
        value: row,
      });
    }
  }

  override query(primaryFilter?: FilterExpr | null | undefined): SelectQuery {
    const tableName = this.sourceTable();
    const tableState = this.#store.state.tableState;
    const pagination = tableState.pagination;
    this.getColumnsDefs();

    const sorting = tableState.sorting.filter((sort) =>
      this.#columnDefIdToSqlColumnAccessor.has(sort.id),
    );

    const tableColumns = this.sqlColumns();

    const statement = mSql.Query.from(tableName).select(...tableColumns, {
      [this.#sql_total_rows]: mSql.sql`COUNT(*) OVER()`,
    });

    const whereClauses: Array<mSql.FilterExpr> = [];
    if (primaryFilter) whereClauses.push(primaryFilter);

    const internalFilters = this._generateFilterPredicates();
    if (internalFilters.length > 0) whereClauses.push(...internalFilters);

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

    logger.debounce('sql-query', 300, 'info', 'SQL', 'Generated Query', {
      sql: statement.toString(),
      context: {
        pagination: tableState.pagination,
        sorting: tableState.sorting,
        columnFilters: tableState.columnFilters,
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

  public async loadColumnMinMax(columnId: string) {
    if (this.#columnDefIdToSqlColumnAccessor.size === 0) {
      this.getColumnsDefs();
    }
    const sqlColumnName = this.#columnDefIdToSqlColumnAccessor.get(columnId);
    if (!sqlColumnName) {
      logger.warn(
        'Core',
        `Cannot load MinMax: No SQL column found for ${columnId}`,
      );
      return;
    }

    const sqlCol = column(sqlColumnName);
    const query = mSql.Query.from(this.sourceTable())
      .select({
        min: mSql.min(sqlCol),
        max: mSql.max(sqlCol),
      })
      .where(this.filterBy?.predicate(this) || []);

    try {
      if (!this.coordinator) return;
      const result = await this.coordinator.query(query);
      const row = result.get(0);

      batch(() => {
        this.#store.setState((prev) => {
          const newMinMax = new Map(prev.facetMinMax);
          newMinMax.set(columnId, [row?.min ?? null, row?.max ?? null]);
          return { ...prev, facetMinMax: newMinMax };
        });
      });
    } catch (e) {
      logger.error('Core', `Failed to load MinMax for ${columnId}`, {
        error: e,
      });
    }
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
        if (matchedField) {
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
    if (!this.#store || !this.#store.state)
      return {
        columnDefs: [],
        columnAccessorKeys: [],
        shouldSearchAllColumns: false,
      };

    const columnDefs = this.#store.state.columnDefs;
    this.#columnDefIdToSqlColumnAccessor.clear();

    const queryableColumns = columnDefs.filter((def) => {
      if ('accessorKey' in def && typeof def.accessorKey === 'string')
        return true;
      if ('accessorFn' in def && typeof def.accessorFn === 'function')
        return true;
      return false;
    });

    let shouldSearchAllColumns = queryableColumns.length === 0;
    let columnAccessorKeys: Array<string> = [];

    queryableColumns.forEach((def) => {
      let columnAccessor: string | undefined = undefined;
      if ('accessorKey' in def && def.accessorKey) {
        columnAccessor =
          typeof def.accessorKey === 'string'
            ? def.accessorKey
            : def.accessorKey.toString();
      } else if ('accessorFn' in def && typeof def.accessorFn === 'function') {
        if (def.meta?.mosaicDataTable?.sqlColumn) {
          columnAccessor = def.meta.mosaicDataTable.sqlColumn;
        }
      }

      if (columnAccessor) {
        columnAccessorKeys.push(columnAccessor);
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
      getFacetedMinMaxValues: (table, columnId) => () => {
        const cached = state.facetMinMax.get(columnId);
        if (!cached) return undefined;
        const [min, max] = cached;
        if (typeof min === 'number' && typeof max === 'number')
          return [min, max];
        return undefined;
      },
      state: state.tableState,

      // Inject metadata handlers for Interaction
      meta: {
        onRowHover: (row: TData | null) =>
          this.handleRowInteraction(row, this.hoverAs, 'hover'),
        onRowClick: (row: TData | null) =>
          this.handleRowInteraction(row, this.clickAs, 'click'),
        ...state.tableOptions.meta,
      },

      onStateChange: (updater) => {
        const oldState = this.#store.state.tableState;
        const nextTableState = functionalUpdate(updater, oldState);

        const filtersChanged =
          JSON.stringify(oldState.columnFilters) !==
            JSON.stringify(nextTableState.columnFilters) ||
          oldState.globalFilter !== nextTableState.globalFilter;

        if (filtersChanged) nextTableState.pagination.pageIndex = 0;

        const hashedOldState = JSON.stringify(oldState);
        const hashedNewState = JSON.stringify(nextTableState);

        this.#store.setState((prev) => ({
          ...prev,
          tableState: nextTableState,
        }));

        if (filtersChanged && this.internalFilterSelection) {
          const predicates = this._generateFilterPredicates();
          const combinedPredicate =
            predicates.length > 0 ? mSql.and(...predicates) : null;

          this.internalFilterSelection.update({
            source: this,
            predicate: combinedPredicate,
            value: {
              columnFilters: nextTableState.columnFilters,
              globalFilter: nextTableState.globalFilter,
            },
          });
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