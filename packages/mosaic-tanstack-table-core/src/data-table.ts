/**
 * Orchestrator for the Mosaic and TanStack Table integration.
 * Manages the data-fetching lifecycle, schema mapping, and reactive state synchronization.
 * Handles bidirectional state management between TanStack (local state) and Mosaic (Selections).
 * Automatically resets internal state when the underlying data source changes.
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
import { Store, batch } from '@tanstack/store';
import { seedInitialTableState, toSafeSqlColumnName } from './utils';
import { logger } from './logger';
import { ColumnMapper } from './query/column-mapper';
import { buildTableQuery, extractInternalFilters } from './query/query-builder';
import { MosaicSelectionManager } from './selection-manager';
import { createLifecycleManager, handleQueryError } from './client-utils';
import { SidecarManager } from './sidecar-manager';
import { StrategyRegistry } from './registry';
import { defaultFilterStrategies } from './query/filter-factory';
import { defaultFacetStrategies } from './facet-strategies';
import { buildGroupedLevelQuery } from './grouped/query-builder';
import { createFlatTableOptions } from './internal/data-table/flat-table-options';
import { materializeFlatQueryResult } from './internal/data-table/flat-table-result';
import { GroupedTableController } from './internal/data-table/grouped-controller';
import {
  createInitialDataTableStore,
  createInitialGroupedState,
} from './internal/data-table/store';

import type {
  Coordinator,
  FieldInfo,
  FieldInfoRequest,
} from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { ReadonlyStore } from '@tanstack/store';
import type {
  ColumnDef,
  RowData,
  Table,
  TableOptions,
} from '@tanstack/table-core';
import type {
  IMosaicClient,
  MosaicDataTableOptions,
  MosaicDataTableStore,
  MosaicTableSource,
  PrimitiveSqlValue,
} from './types';
import type { FilterStrategy } from './query/filter-factory';
import type {
  FacetStrategyKey,
  FacetStrategyKeyWithoutInput,
  FacetStrategyMap,
  SidecarRequest,
} from './registry';

type SelectExpression =
  | ReturnType<typeof mSql.column>
  | ReturnType<typeof mSql.sql>;

export function createMosaicDataTableClient<
  TData extends RowData,
  TValue extends PrimitiveSqlValue = PrimitiveSqlValue,
>(options: MosaicDataTableOptions<TData, TValue>) {
  const client = new MosaicDataTable<TData, TValue>(options);
  return client;
}

/**
 * The core adapter class that bridges TanStack Table state with Mosaic SQL execution.
 */
export class MosaicDataTable<
  TData extends RowData,
  TValue extends PrimitiveSqlValue = PrimitiveSqlValue,
>
  extends MosaicClient
  implements IMosaicClient
{
  public readonly id: string;
  source: MosaicTableSource;
  schema: Array<FieldInfo> = [];
  tableFilterSelection: Selection = new Selection();
  options: MosaicDataTableOptions<TData, TValue>;

  #store: Store<MosaicDataTableStore<TData, TValue>> | null = null;
  #sqlTotalRows = toSafeSqlColumnName('__total_rows');
  #onTableStateChange: 'requestQuery' | 'requestUpdate' = 'requestUpdate';
  #columnMapper: ColumnMapper<TData, TValue> | undefined;
  #facetValues = new Map<string, unknown>();
  #rowSelectionManager?: MosaicSelectionManager<string | number>;
  #groupedController = new GroupedTableController(this);

  public sidecarManager: SidecarManager<TData, TValue>;
  public filterRegistry: StrategyRegistry<Record<string, FilterStrategy>>;
  public facetRegistry: StrategyRegistry<FacetStrategyMap>;

  get #isGrouped(): boolean {
    return !!this.options.groupBy;
  }

  private lifecycle = createLifecycleManager(this);
  private _cleanupListener?: () => void;

  constructor(options: MosaicDataTableOptions<TData, TValue>) {
    super(options.filterBy);
    this.id = Math.random().toString(36).substring(2, 9);
    this.options = options;
    this.source = options.table;

    this.filterRegistry = new StrategyRegistry({
      ...defaultFilterStrategies,
      ...options.filterStrategies,
    });

    this.facetRegistry = new StrategyRegistry({
      ...defaultFacetStrategies,
      ...options.facetStrategies,
    });

    this.sidecarManager = new SidecarManager(this, this.facetRegistry);

    logger.debug(
      'Core',
      `[MosaicDataTable #${this.id}] Initializing with debugName: ${options.__debugName}`,
    );

    this.updateOptions(options);
  }

  get isConnected() {
    return this.lifecycle.isConnected;
  }

  setCoordinator(coordinator: Coordinator) {
    this.lifecycle.handleCoordinatorSwap(this.coordinator, coordinator, () =>
      this.connect(),
    );
    this.coordinator = coordinator;
  }

  connect(): () => void {
    return this.lifecycle.connect(this.coordinator);
  }

  disconnect() {
    this.lifecycle.disconnect(this.coordinator);
  }

  override requestQuery(query?: SelectQuery): Promise<unknown> | null {
    if (!this.coordinator) {
      return Promise.resolve();
    }
    if (this.enabled === false) {
      return Promise.resolve();
    }
    return super.requestQuery(query);
  }

  override queryError(error: Error): this {
    handleQueryError(`MosaicDataTable #${this.id}`, error);
    if (this.#isGrouped) {
      this.#groupedController.handleQueryError();
    }
    return this;
  }

  override get filterStable() {
    if (this.#isGrouped) {
      return true;
    }
    return super.filterStable;
  }

  updateOptions(options: MosaicDataTableOptions<TData, TValue>): void {
    const sourceChanged = this.source !== options.table;
    const wasEnabled = this.enabled;

    this.options = options;
    this.source = options.table;

    this.#applyEnabledOption(options);
    this.#applyStateChangeMode(options);
    this.#registerStrategies(options);

    if (sourceChanged) {
      this.sidecarManager.updateSource(options.table);
    }

    this.tableFilterSelection =
      options.tableFilterSelection ?? this.tableFilterSelection;

    this.#ensureStore(options);

    if (sourceChanged) {
      this.#resetForSourceChange(options);
    }

    this.#configureRowSelection(options);

    const coordinator =
      options.coordinator || this.coordinator || defaultCoordinator();
    this.setCoordinator(coordinator);
    this.sidecarManager.updateCoordinators(coordinator);

    if (options.totalRowsMode === 'split') {
      this.sidecarManager.requestTotalCount();
    }

    this.#configureColumns(options, sourceChanged);

    if (this.enabled && !wasEnabled) {
      this.requestUpdate();
    }
  }

  public requestAuxiliary(config: SidecarRequest<TData>) {
    this.sidecarManager.requestAuxiliary(config);
  }

  public requestFacet(columnId: string, type: FacetStrategyKeyWithoutInput) {
    this.sidecarManager.requestFacet(columnId, type);
  }

  resolveSource(filter?: FilterExpr | null): string | SelectQuery {
    if (typeof this.source === 'function') {
      return this.source(filter);
    }
    if (isParam(this.source)) {
      return this.source.value as string;
    }
    return this.source as string;
  }

  override query(
    primaryFilter?: FilterExpr | null | undefined,
  ): SelectQuery | null {
    if (!this.enabled) {
      return null;
    }

    if (this.#isGrouped) {
      const groupBy = this.options.groupBy!;
      return buildGroupedLevelQuery({
        table: this.source as string,
        groupBy: groupBy.levels,
        depth: 0,
        metrics: groupBy.metrics,
        parentConstraints: {},
        filterPredicate: primaryFilter ?? undefined,
        additionalWhere: groupBy.additionalWhere ?? undefined,
        limit: groupBy.pageSize ?? 200,
      });
    }

    const source = this.resolveSource(primaryFilter);
    if (!source || (typeof source === 'string' && source.trim() === '')) {
      return null;
    }

    let highlightPredicate: FilterExpr | null = null;
    let crossFilterPredicate: FilterExpr | null = null;

    if (this.options.highlightBy) {
      crossFilterPredicate = this.options.highlightBy.predicate(this) ?? null;
      highlightPredicate = this.options.highlightBy.predicate(null) ?? null;
    }

    const filtersToApply: Array<FilterExpr> = [];
    if (primaryFilter) {
      filtersToApply.push(primaryFilter);
    }
    if (crossFilterPredicate) {
      filtersToApply.push(crossFilterPredicate);
    }

    let effectiveFilter: FilterExpr | null = null;
    if (filtersToApply.length > 1) {
      effectiveFilter = mSql.and(...filtersToApply);
    } else if (filtersToApply.length === 1) {
      effectiveFilter = filtersToApply[0]!;
    }

    const safeHighlightPredicate = crossFilterPredicate
      ? null
      : highlightPredicate;
    const tableState = this.store.state.tableState;
    const mapper = this.#columnMapper;
    let statement: SelectQuery;

    if (mapper) {
      statement = buildTableQuery({
        source,
        tableState,
        mapper,
        mapping: this.options.mapping,
        totalRowsColumnName: this.#sqlTotalRows,
        highlightPredicate: safeHighlightPredicate,
        manualHighlight: this.options.manualHighlight,
        totalRowsMode: this.options.totalRowsMode,
        filterRegistry: this.filterRegistry,
      });
    } else {
      const selects: Record<string, SelectExpression> = {
        '*': mSql.column('*'),
      };

      if (this.options.totalRowsMode === 'window') {
        selects[this.#sqlTotalRows] = mSql.sql`COUNT(*) OVER()`;
      }

      statement = mSql.Query.from(source).select(selects);

      if (tableState.sorting.length > 0) {
        const ordering = tableState.sorting.map((sort) => {
          const column = mSql.column(sort.id);
          return sort.desc ? mSql.desc(column) : mSql.asc(column);
        });
        statement.orderby(...ordering);
      }
    }

    if (effectiveFilter && typeof this.source === 'string') {
      statement.where(effectiveFilter);
    }

    if (mapper) {
      const internalClauses = extractInternalFilters({
        tableState,
        mapper,
        mapping: this.options.mapping,
        filterRegistry: this.filterRegistry,
      });
      const predicate =
        internalClauses.length > 0 ? mSql.and(...internalClauses) : null;

      this.tableFilterSelection.update({
        source: this,
        value: tableState.columnFilters,
        predicate,
      });
    } else {
      statement.limit(tableState.pagination.pageSize || 50);
      if (tableState.pagination.pageIndex > 0) {
        statement.offset(
          tableState.pagination.pageIndex * tableState.pagination.pageSize,
        );
      }
    }

    return statement;
  }

  public getCascadingFilters(options?: {
    excludeColumnId?: string;
  }): Array<mSql.FilterExpr> {
    const tableState = this.store.state.tableState;
    const excludeColumnId = options?.excludeColumnId;
    const filteredState = excludeColumnId
      ? {
          ...tableState,
          columnFilters: tableState.columnFilters.filter(
            (filter) => filter.id !== excludeColumnId,
          ),
        }
      : tableState;

    if (!this.#columnMapper) {
      return [];
    }

    return extractInternalFilters({
      tableState: filteredState,
      mapper: this.#columnMapper,
      mapping: this.options.mapping,
      filterRegistry: this.filterRegistry,
    });
  }

  override queryPending(): this {
    return this;
  }

  get debugPrefix(): string {
    return this.options.__debugName ? `${this.options.__debugName}:` : '';
  }

  override queryResult(table: unknown): this {
    if (this.#isGrouped) {
      if (isArrowTable(table)) {
        this.#groupedController.handleQueryResult(table);
      }
      return this;
    }

    if (!isArrowTable(table)) {
      logger.error('Core', 'Received non-Arrow result:', { table });
      return this;
    }

    const result = materializeFlatQueryResult({
      rows: table.toArray() as Array<Record<string, unknown>>,
      options: this.options,
      totalRowsColumnName: this.#sqlTotalRows,
      debugPrefix: this.debugPrefix,
    });

    batch(() => {
      this.store.setState((previousState) => ({
        ...previousState,
        rows: result.rows,
        totalRows:
          this.options.totalRowsMode === 'window'
            ? result.totalRows
            : previousState.totalRows,
      }));
    });

    return this;
  }

  override async prepare(): Promise<void> {
    if (!this.enabled || this.#isGrouped) {
      return Promise.resolve();
    }

    const source = this.resolveSource();
    if (!source || (typeof source === 'string' && source.trim() === '')) {
      return Promise.resolve();
    }

    if (typeof source === 'string') {
      this.schema = await queryFieldInfo(this.coordinator!, this.fields());

      if (this.schema.length > 0 && this.options.columns === undefined) {
        const inferredColumns = this.schema.map((field) => ({
          accessorKey: field.column,
          id: field.column,
          meta: { dataType: field.type },
        })) as Array<ColumnDef<TData, TValue>>;

        if (!this.#columnMapper) {
          this.#columnMapper = new ColumnMapper(inferredColumns);
        }

        batch(() => {
          this.store.setState((previousState) => ({
            ...previousState,
            columnDefs: inferredColumns,
          }));
        });
      }

      if (this.schema.length > 0) {
        this.sidecarManager.refreshAll();
      }
    }

    return Promise.resolve();
  }

  public __onConnect() {
    this.enabled = this.options.enabled !== false;

    if (this.#isGrouped) {
      return;
    }

    this.sidecarManager.connectAll();
    this.sidecarManager.refreshAll();

    const selectionCb = () => {
      const activeClause =
        this.filterBy?.active || this.options.highlightBy?.active;
      const isSelfUpdate = activeClause?.source === this;

      if (!isSelfUpdate) {
        batch(() => {
          this.store.setState((previousState) => ({
            ...previousState,
            tableState: {
              ...previousState.tableState,
              pagination: {
                ...previousState.tableState.pagination,
                pageIndex: 0,
              },
            },
          }));
        });
      }

      this.requestUpdate();
    };

    const internalFilterCb = () => {
      const active = this.tableFilterSelection.active;
      if (active.source === this) {
        return;
      }

      const value = this.tableFilterSelection.value;
      const isEmpty = !value || (Array.isArray(value) && value.length === 0);

      if (!isEmpty) {
        return;
      }

      batch(() => {
        this.store.setState((previousState) => ({
          ...previousState,
          tableState: {
            ...previousState.tableState,
            columnFilters: [],
            pagination: {
              ...previousState.tableState.pagination,
              pageIndex: 0,
            },
            sorting: [],
          },
        }));
      });

      this.requestUpdate();
      this.sidecarManager.refreshAll();
    };

    const rowSelectionCb = () => {
      if (!this.#rowSelectionManager) {
        return;
      }

      const values = this.#rowSelectionManager.getCurrentValues();
      const nextSelection: Record<string, boolean> = {};
      values.forEach((value) => {
        nextSelection[String(value)] = true;
      });

      batch(() => {
        this.store.setState((previousState) => ({
          ...previousState,
          tableState: {
            ...previousState.tableState,
            rowSelection: nextSelection,
          },
        }));
      });
    };

    this.filterBy?.addEventListener('value', selectionCb);
    this.options.highlightBy?.addEventListener('value', selectionCb);
    this.tableFilterSelection.addEventListener('value', internalFilterCb);

    if (this.options.rowSelection?.selection) {
      this.options.rowSelection.selection.addEventListener(
        'value',
        rowSelectionCb,
      );
      rowSelectionCb();
    }

    this._cleanupListener = () => {
      this.enabled = false;
      this.filterBy?.removeEventListener('value', selectionCb);
      this.options.highlightBy?.removeEventListener('value', selectionCb);
      this.tableFilterSelection.removeEventListener('value', internalFilterCb);
      this.options.rowSelection?.selection.removeEventListener(
        'value',
        rowSelectionCb,
      );
      this.sidecarManager.disconnectAll();
    };
  }

  public __onDisconnect() {
    this._cleanupListener?.();
  }

  destroy(): void {
    super.destroy();
    this.sidecarManager.clear();
    this.#groupedController.reset();
  }

  fields(): Array<FieldInfoRequest> {
    if (!this.enabled || this.#isGrouped) {
      return [];
    }

    const source = this.resolveSource();
    if (!source || (typeof source === 'string' && source.trim() === '')) {
      return [];
    }

    if (typeof source !== 'string') {
      return [];
    }

    if (!this.#columnMapper) {
      return [{ table: source, column: '*' }];
    }

    return this.#columnMapper.getMosaicFieldRequests(source);
  }

  getTableOptions(
    state: Store<MosaicDataTableStore<TData, TValue>>['state'],
  ): TableOptions<TData> {
    if (this.#isGrouped) {
      return this.#groupedController.getTableOptions(state);
    }

    return createFlatTableOptions({
      client: this,
      state,
      schema: this.schema,
      rowSelectionManager: this.#rowSelectionManager,
      onTableStateChange: this.#onTableStateChange,
    });
  }

  getFacetedUniqueValues<TItem extends RowData>(): (
    table: Table<TItem>,
    columnId: string,
  ) => () => Map<unknown, number> {
    return (_table, columnId) => {
      return () => {
        const values = this.getFacetValue<Array<unknown>>(
          columnId,
          Array.isArray,
        );
        if (!values) {
          return new Map<unknown, number>();
        }
        if (Array.isArray(values)) {
          const map = new Map<unknown, number>();
          values.forEach((value) => {
            map.set(value, 1);
          });
          return map;
        }
        return new Map<unknown, number>();
      };
    };
  }

  getFacetedMinMaxValues<TItem extends RowData>(): (
    table: Table<TItem>,
    columnId: string,
  ) => () => [number, number] | undefined {
    return (_table, columnId) => {
      return () => {
        const values = this.getFacetValue<Array<unknown>>(
          columnId,
          Array.isArray,
        );
        if (Array.isArray(values) && values.length === 2) {
          return values as [number, number];
        }
        return undefined;
      };
    };
  }

  get store(): Store<MosaicDataTableStore<TData, TValue>> {
    if (!this.#store) {
      throw new Error('MosaicDataTable store accessed before initialization.');
    }
    return this.#store;
  }

  getFacets(): Map<string, unknown> {
    return this.#facetValues;
  }

  getFacetValue<T>(
    columnId: string,
    guard?: (val: unknown) => val is T,
  ): T | undefined {
    const value = this.#facetValues.get(columnId);

    if (value === undefined) {
      return undefined;
    }

    if (guard && !guard(value)) {
      logger.error('Core', `Facet type mismatch for column ${columnId}`);
      return undefined;
    }

    return value as T;
  }

  updateFacetValue(columnId: string, value: unknown) {
    this.#facetValues.set(columnId, value);
    batch(() => {
      this.store.setState((previousState) => ({
        ...previousState,
        _facetsUpdateCount: previousState._facetsUpdateCount + 1,
      }));
    });
  }

  updateTotalRows(count: number) {
    const safeCount = typeof count === 'bigint' ? Number(count) : count;

    batch(() => {
      this.store.setState((previousState) => ({
        ...previousState,
        totalRows: safeCount,
      }));
    });
  }

  getColumnSqlName(columnId: string): string | undefined {
    return this.#columnMapper?.getSqlColumn(columnId)?.toString();
  }

  getColumnDef(sqlColumn: string): ColumnDef<TData, TValue> | undefined {
    return this.#columnMapper?.getColumnDef(sqlColumn);
  }

  get isEnabled() {
    return this.isConnected && this.enabled;
  }

  get isGroupedMode(): boolean {
    return this.#isGrouped;
  }

  get groupedStore(): ReadonlyStore<
    MosaicDataTableStore<TData, TValue>['_grouped']
  > {
    return this.#groupedController.groupedStore;
  }

  get groupedState() {
    return this.#groupedController.groupedState;
  }

  isRowLoading(rowId: string): boolean {
    return this.#groupedController.isRowLoading(rowId);
  }

  #applyEnabledOption(options: MosaicDataTableOptions<TData, TValue>): void {
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
  }

  #applyStateChangeMode(options: MosaicDataTableOptions<TData, TValue>): void {
    if (options.onTableStateChange) {
      this.#onTableStateChange = options.onTableStateChange;
    }
  }

  #registerStrategies(options: MosaicDataTableOptions<TData, TValue>): void {
    if (options.filterStrategies) {
      Object.entries(options.filterStrategies).forEach(([key, strategy]) =>
        this.filterRegistry.register(key, strategy),
      );
    }
    if (options.facetStrategies) {
      Object.entries(options.facetStrategies).forEach(([key, strategy]) =>
        this.facetRegistry.register(key as FacetStrategyKey, strategy),
      );
    }
  }

  #ensureStore(options: MosaicDataTableOptions<TData, TValue>): void {
    if (!this.#store) {
      this.#store = new Store(createInitialDataTableStore(options));
      return;
    }

    if (options.columns !== undefined) {
      this.#store.setState((previousState) => ({
        ...previousState,
        columnDefs: options.columns!,
      }));
    }
  }

  #resetForSourceChange(options: MosaicDataTableOptions<TData, TValue>): void {
    logger.debug(
      'Core',
      `[MosaicDataTable] Table source changed to ${this.source}. Performing atomic state reset.`,
    );

    batch(() => {
      this.store.setState((previousState) => ({
        ...previousState,
        tableState: seedInitialTableState<TData>(
          options.tableOptions?.initialState,
        ),
        rows: [],
        totalRows: undefined,
        _grouped: createInitialGroupedState<TData, TValue>(),
      }));
    });

    this.#groupedController.reset();
    this.tableFilterSelection.update({
      source: this,
      value: [],
      predicate: null,
    });
  }

  #configureRowSelection(options: MosaicDataTableOptions<TData, TValue>): void {
    if (!options.rowSelection) {
      this.#rowSelectionManager = undefined;
      return;
    }

    this.#rowSelectionManager = new MosaicSelectionManager<string | number>({
      client: this,
      column: options.rowSelection.column,
      selection: options.rowSelection.selection,
      columnType: options.rowSelection.columnType,
    });
  }

  #configureColumns(
    options: MosaicDataTableOptions<TData, TValue>,
    sourceChanged: boolean,
  ): void {
    if (options.columns) {
      if (options.__debugName?.includes('DetailTable')) {
        logger.debug(
          'Core',
          `[MosaicDataTable #${this.id}] Updating Columns. Count: ${options.columns.length}`,
        );
      }

      this.#columnMapper = new ColumnMapper(options.columns, options.mapping);
      return;
    }

    if (!sourceChanged) {
      return;
    }

    this.schema = [];
    this.#columnMapper = undefined;
    this.store.setState((previousState) => ({
      ...previousState,
      columnDefs: [],
      rows: [],
    }));

    if (this.isConnected) {
      void this.prepare().then(() => {
        this.requestUpdate();
      });
    }
  }
}
