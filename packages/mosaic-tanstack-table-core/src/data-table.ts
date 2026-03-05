// packages/mosaic-tanstack-table-core/src/data-table.ts
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
import {
  getCoreRowModel,
  getExpandedRowModel,
  getFacetedRowModel,
} from '@tanstack/table-core';
import { ReadonlyStore, Store, batch } from '@tanstack/store';
import {
  functionalUpdate,
  seedInitialTableState,
  toSafeSqlColumnName,
} from './utils';
import { logger } from './logger';
import { ColumnMapper } from './query/column-mapper';
import { buildTableQuery, extractInternalFilters } from './query/query-builder';
import { MosaicSelectionManager } from './selection-manager';
import { createLifecycleManager, handleQueryError } from './client-utils';
import { SidecarManager } from './sidecar-manager';
import { StrategyRegistry } from './registry';
import { defaultFilterStrategies } from './query/filter-factory';
import { defaultFacetStrategies } from './facet-strategies';
import { createMosaicFeature } from './feature';
import { arrowTableToObjects } from './grouped/arrow-utils';
import { createGroupedTableFeature } from './grouped/feature';
import {
  buildGroupedLevelQuery,
  buildLeafRowsQuery,
} from './grouped/query-builder';
import { GROUP_ID_SEPARATOR } from './grouped/types';

import type {
  Coordinator,
  FieldInfo,
  FieldInfoRequest,
} from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  ColumnDef,
  ExpandedState,
  RowData,
  Table,
  TableOptions,
  Updater,
} from '@tanstack/table-core';
import type {
  IMosaicClient,
  MosaicDataTableOptions,
  MosaicDataTableStore,
  MosaicTableSource,
  PrimitiveSqlValue,
} from './types';
import type { FilterStrategy } from './query/filter-factory';
import type { FacetStrategy } from './facet-strategies';
import type { SidecarRequest } from './registry';
import type { FlatGroupedRow } from './grouped/types';

/** Max number of validation errors to log individually before summarizing */
const MAX_VALIDATION_ERRORS_LOGGED = 5;

// ---------------------------------------------------------------------------
// Grouped-mode helpers (pure functions for ExpandedState diffing)
// ---------------------------------------------------------------------------

/** Safely extract expanded keys from an ExpandedState. */
function getExpandedKeys(state: ExpandedState): Array<string> {
  if (state === true) {
    return [];
  }
  return Object.entries(state)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

/** Safely check if a specific key is expanded. */
function isKeyExpanded(state: ExpandedState, key: string): boolean {
  if (state === true) {
    return true;
  }
  return !!state[key];
}

/** Find keys that are in newExpanded but not in oldExpanded. */
function findNewlyExpandedKeys(
  oldExpanded: ExpandedState,
  newExpanded: ExpandedState,
): Array<string> {
  if (newExpanded === true) {
    return [];
  }
  const newKeys = getExpandedKeys(newExpanded);
  return newKeys.filter((k) => !isKeyExpanded(oldExpanded, k));
}

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
  tableFilterSelection!: Selection;
  options: MosaicDataTableOptions<TData, TValue>;

  #store!: Store<MosaicDataTableStore<TData, TValue>>;
  #sql_total_rows = toSafeSqlColumnName('__total_rows');
  #onTableStateChange: 'requestQuery' | 'requestUpdate' = 'requestUpdate';

  #columnMapper: ColumnMapper<TData, TValue> | undefined;

  public sidecarManager: SidecarManager<TData, TValue>;
  public filterRegistry: StrategyRegistry<FilterStrategy>;
  public facetRegistry: StrategyRegistry<FacetStrategy<any, any>>;

  #facetValues: Map<string, unknown> = new Map();

  // Typed selection manager for row IDs (string or number)
  #rowSelectionManager?: MosaicSelectionManager<string | number>;

  // --- Grouped-mode private state ---
  #childrenCache: Map<string, Array<FlatGroupedRow>> = new Map();
  #groupedRootRows: Array<FlatGroupedRow> = [];
  #autoLeafColumnDefs: Array<ColumnDef<TData, any>> = [];
  #groupedStore!: ReadonlyStore<
    MosaicDataTableStore<TData, TValue>['_grouped']
  >;
  get #isGrouped(): boolean {
    return !!this.options.groupBy;
  }

  private lifecycle = createLifecycleManager(this);

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

    /**
     * Sidecar Manager initialization.
     * We rely on the `SidecarManager` to lazy-load facets only when explicitly requested.
     */
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

  override requestQuery(query?: any): Promise<any> | null {
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
      batch(() => {
        this.store.setState((prev) => ({
          ...prev,
          _grouped: { ...prev._grouped, isRootLoading: false },
        }));
      });
    }
    return this;
  }

  override get filterStable() {
    if (this.#isGrouped) {
      return true;
    }
    return super.filterStable;
  }

  /**
   * Updates configuration options and handles necessary state resets.
   */
  updateOptions(options: MosaicDataTableOptions<TData, TValue>): void {
    const sourceChanged = this.source !== options.table;

    this.options = options;
    this.source = options.table;

    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }

    if (options.onTableStateChange) {
      this.#onTableStateChange = options.onTableStateChange;
    }

    if (options.filterStrategies) {
      Object.entries(options.filterStrategies).forEach(([k, v]) =>
        this.filterRegistry.register(k, v),
      );
    }
    if (options.facetStrategies) {
      Object.entries(options.facetStrategies).forEach(([k, v]) =>
        this.facetRegistry.register(k, v),
      );
    }

    if (sourceChanged) {
      this.sidecarManager.updateSource(options.table);
    }

    const currentSelection = (this as any).tableFilterSelection as
      | Selection
      | undefined;

    this.tableFilterSelection =
      options.tableFilterSelection ?? currentSelection ?? new Selection();

    if (sourceChanged) {
      logger.debug(
        'Core',
        `[MosaicDataTable] Table source changed to ${this.source}. Performing atomic state reset.`,
      );

      batch(() => {
        this.#store.setState((prev) => ({
          ...prev,
          tableState: seedInitialTableState<TData>(
            options.tableOptions?.initialState,
          ),
          rows: [],
          totalRows: undefined,
          _grouped: {
            expanded: {} as ExpandedState,
            loadingGroupIds: [] as Array<string>,
            totalRootRows: 0,
            isRootLoading: false as boolean,
          },
        }));
      });

      this.#childrenCache.clear();
      this.#groupedRootRows = [];
      this.#autoLeafColumnDefs = [];

      this.tableFilterSelection.update({
        source: this,
        value: [],
        predicate: null,
      });
    }

    if (options.rowSelection) {
      this.#rowSelectionManager = new MosaicSelectionManager<string | number>({
        client: this,
        column: options.rowSelection.column,
        selection: options.rowSelection.selection,
        columnType: options.rowSelection.columnType,
      });
    } else {
      this.#rowSelectionManager = undefined;
    }

    const resolvedCoordinator =
      options.coordinator || this.coordinator || defaultCoordinator();

    this.setCoordinator(resolvedCoordinator);
    this.sidecarManager.updateCoordinators(resolvedCoordinator);

    type ResolvedStore = MosaicDataTableStore<TData, TValue>;

    const currentStore = (this as any).#store as
      | Store<ResolvedStore>
      | undefined;

    if (!currentStore) {
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
        _grouped: {
          expanded: {} as ExpandedState,
          loadingGroupIds: [] as Array<string>,
          totalRootRows: 0,
          isRootLoading: false as boolean,
        },
      });

      this.#groupedStore = new ReadonlyStore(() => this.#store.state._grouped);
    } else {
      if (options.columns !== undefined) {
        this.#store.setState((prev) => ({
          ...prev,
          columnDefs: options.columns!,
        }));
      }
    }

    if (options.totalRowsMode === 'split') {
      this.sidecarManager.requestTotalCount();
    }

    if (options.columns) {
      if (options.__debugName?.includes('DetailTable')) {
        logger.debug(
          'Core',
          `[MosaicDataTable #${this.id}] Updating Columns. Count: ${options.columns.length}`,
        );
      }

      this.#columnMapper = new ColumnMapper(options.columns, options.mapping);
    } else if (sourceChanged) {
      // Priority: If source changed and no explicit columns, we must introspect.
      // This block was moved above options.mapping to ensure it runs even if mapping is present but empty.
      this.schema = [];
      this.#columnMapper = undefined;
      this.#store.setState((prev) => ({
        ...prev,
        columnDefs: [],
        rows: [],
      }));

      if (this.isConnected) {
        this.prepare().then(() => {
          this.requestUpdate();
        });
      }
    } else if (options.mapping) {
      // Columns might be inferred from mapping if not explicitly provided
    }

    // Trigger update if enabled status changed to true
    if (this.enabled) {
      this.requestUpdate();
    }
  }

  public requestAuxiliary(config: SidecarRequest<TData>) {
    this.sidecarManager.requestAuxiliary(config);
  }

  /**
   * Request a specific facet for a column.
   * Useful for lazy-loading metadata like Min/Max or Unique Values.
   */
  public requestFacet(columnId: string, type: string) {
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

  /**
   * Constructs the main table query based on the current state.
   */
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

    const hardFilter = primaryFilter;

    let highlightPredicate: FilterExpr | null = null;
    let crossFilterPredicate: FilterExpr | null = null;

    if (this.options.highlightBy) {
      crossFilterPredicate = this.options.highlightBy.predicate(this) ?? null;
      highlightPredicate = this.options.highlightBy.predicate(null) ?? null;
    }

    // Combine filters avoiding unsafe conditionals
    const filtersToApply: Array<FilterExpr> = [];
    if (hardFilter) {
      filtersToApply.push(hardFilter);
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

    // Use QueryBuilder if mapper exists.
    // If NO mapper (initial discovery state), use a lightweight fallback.
    let statement: SelectQuery;

    if (mapper) {
      statement = buildTableQuery({
        source,
        tableState,
        mapper: mapper,
        mapping: this.options.mapping,
        totalRowsColumnName: this.#sql_total_rows,
        highlightPredicate: safeHighlightPredicate,
        manualHighlight: this.options.manualHighlight,
        totalRowsMode: this.options.totalRowsMode,
        filterRegistry: this.filterRegistry,
      });
    } else {
      // Fallback Path (Introspection Pending)
      const selects: Record<string, any> = { '*': mSql.column('*') };

      if (this.options.totalRowsMode === 'window') {
        selects[this.#sql_total_rows] = mSql.sql`COUNT(*) OVER()`;
      }

      statement = mSql.Query.from(source).select(selects);

      // Apply Sorting in Fallback Mode
      if (tableState.sorting.length > 0) {
        const ordering = tableState.sorting.map((sort) => {
          const col = mSql.column(sort.id);
          return sort.desc ? mSql.desc(col) : mSql.asc(col);
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
        mapper: mapper,
        mapping: this.options.mapping,
        filterRegistry: this.filterRegistry,
      });

      const predicate =
        internalClauses.length > 0 ? mSql.and(...internalClauses) : null;

      this.tableFilterSelection.update({
        source: this,
        value: tableState.columnFilters,
        predicate: predicate,
      });
    } else {
      // Apply Pagination Offset in Fallback Mode
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

    const excludeId = options?.excludeColumnId;

    const filteredState = excludeId
      ? {
          ...tableState,
          columnFilters: tableState.columnFilters.filter(
            (f) => f.id !== excludeId,
          ),
        }
      : tableState;

    const mapper = this.#columnMapper;

    if (!mapper) {
      return [];
    }

    return extractInternalFilters({
      tableState: filteredState,
      mapper: mapper,
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
      return this.#handleGroupedQueryResult(table);
    }

    if (isArrowTable(table)) {
      let totalRows: number | undefined = undefined;
      // Convert to array of objects
      let rows: Array<unknown> = table.toArray();

      // Apply optional converter if provided
      if (this.options.converter) {
        try {
          rows = rows.map((r) =>
            this.options.converter!(r as Record<string, unknown>),
          );
        } catch (err) {
          logger.warn(
            'Core',
            `[MosaicDataTable ${this.debugPrefix}] Converter failed. Proceeding with raw data.`,
            { error: err },
          );
        }
      }

      // Boundary Validation Logic
      if (
        this.options.validateRow &&
        this.options.validationMode &&
        this.options.validationMode !== 'none'
      ) {
        if (rows.length > 0) {
          const rowsToValidate =
            this.options.validationMode === 'first' ? [rows[0]] : rows;
          let invalidCount = 0;

          rowsToValidate.forEach((row, idx) => {
            if (!this.options.validateRow!(row)) {
              invalidCount++;
              if (
                this.options.validationMode === 'first' ||
                invalidCount < MAX_VALIDATION_ERRORS_LOGGED
              ) {
                logger.error(
                  'Core',
                  `[MosaicDataTable ${this.debugPrefix}] Row validation failed at index ${idx}. Schema mismatch.`,
                  { row },
                );
              }
            }
          });

          if (invalidCount > 0) {
            logger.warn(
              'Core',
              `[MosaicDataTable ${this.debugPrefix}] ${invalidCount} rows failed validation.`,
            );
          }
        }
      }

      const typedRows = rows as Array<TData>;

      if (
        this.options.totalRowsMode === 'window' &&
        typedRows.length > 0 &&
        typedRows[0] &&
        typeof typedRows[0] === 'object' &&
        this.#sql_total_rows in (typedRows[0] as Record<string, any>)
      ) {
        const firstRow = typedRows[0] as Record<string, any>;
        const rawTotal = firstRow[this.#sql_total_rows];

        // Safe coercion — Number() handles bigint, string, and number
        totalRows = Number(rawTotal);
      }

      batch(() => {
        this.store.setState((prev) => {
          return {
            ...prev,
            rows: typedRows,
            totalRows:
              this.options.totalRowsMode === 'window'
                ? totalRows
                : prev.totalRows,
          };
        });
      });
    } else {
      logger.error('Core', 'Received non-Arrow result:', { table });
    }

    return this;
  }

  /**
   * Prepares the client for execution.
   */
  override async prepare(): Promise<void> {
    if (!this.enabled || this.#isGrouped) {
      return Promise.resolve();
    }

    const source = this.resolveSource();

    if (!source || (typeof source === 'string' && source.trim() === '')) {
      return Promise.resolve();
    }

    if (typeof source === 'string') {
      const schema = await queryFieldInfo(this.coordinator!, this.fields());
      this.schema = schema;

      const mapper = this.#columnMapper;

      if (schema.length > 0 && this.options.columns === undefined) {
        const inferredColumns = schema.map((s) => ({
          accessorKey: s.column,
          id: s.column,
          meta: { dataType: s.type },
        }));

        if (!mapper) {
          this.#columnMapper = new ColumnMapper(inferredColumns as any);
        }

        batch(() => {
          this.#store.setState((prev) => ({
            ...prev,
            columnDefs: inferredColumns as any,
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
    // If enabled option is not provided, default to true
    if (this.options.enabled !== false) {
      this.enabled = true;
    } else {
      this.enabled = false;
    }

    if (this.#isGrouped) {
      // Coordinator handles filterBy changes via query/queryResult lifecycle.
      // No manual selection listeners needed for grouped mode.
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
          this.store.setState((prev) => ({
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

      this.requestUpdate();
    };

    const internalFilterCb = () => {
      const active = this.tableFilterSelection.active;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (active && active.source === this) {
        return;
      }

      const val = this.tableFilterSelection.value;
      const isEmpty = !val || (Array.isArray(val) && val.length === 0);

      if (isEmpty) {
        batch(() => {
          this.store.setState((prev) => ({
            ...prev,
            tableState: {
              ...prev.tableState,
              columnFilters: [],
              pagination: {
                ...prev.tableState.pagination,
                pageIndex: 0,
              },
              sorting: [],
            },
          }));
        });
        this.requestUpdate();
        this.sidecarManager.refreshAll();
      }
    };

    const rowSelectionCb = () => {
      if (!this.#rowSelectionManager) {
        return;
      }

      const values = this.#rowSelectionManager.getCurrentValues();

      const newRowSelection: Record<string, boolean> = {};
      values.forEach((v) => {
        newRowSelection[String(v)] = true;
      });

      batch(() => {
        this.store.setState((prev) => ({
          ...prev,
          tableState: {
            ...prev.tableState,
            rowSelection: newRowSelection,
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
      // Use internal property to avoid triggering side-effects during cleanup
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

  private _cleanupListener?: () => void;

  public __onDisconnect() {
    this._cleanupListener?.();
  }

  destroy(): void {
    super.destroy();
    this.sidecarManager.clear();
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

    const mapper = this.#columnMapper;

    if (!mapper) {
      return [{ table: source, column: '*' }];
    }

    return mapper.getMosaicFieldRequests(source);
  }

  getTableOptions(
    state: Store<MosaicDataTableStore<TData, TValue>>['state'],
  ): TableOptions<TData> {
    if (this.#isGrouped) {
      return this.#getGroupedTableOptions(state);
    }

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
        const oldState = this.store.state.tableState;
        const newState = functionalUpdate(updater, oldState);

        const hashedOldFilters = JSON.stringify(oldState.columnFilters);
        const hashedNewFilters = JSON.stringify(newState.columnFilters);
        const hasFiltersChanged = hashedOldFilters !== hashedNewFilters;

        if (!hasFiltersChanged && typeof updater === 'function') {
          logger.debug(
            'Core',
            `[MosaicDataTable] State update received but ignored. Input might have been rejected by Table Core.`,
            {
              prevFilters: oldState.columnFilters,
              newFilters: newState.columnFilters,
            },
          );
        }

        logger.info('TanStack-Table', 'State Change', {
          id: this.id,
          newState: {
            pagination: newState.pagination,
            sorting: newState.sorting,
            filters: newState.columnFilters,
          },
        });

        this.store.setState((prev) => ({
          ...prev,
          tableState: newState,
        }));

        const hashedOldState = JSON.stringify(oldState);
        const hashedNewState = JSON.stringify(newState);

        if (hashedOldState !== hashedNewState) {
          if (hasFiltersChanged) {
            this.sidecarManager.refreshAll();
          }

          this[this.#onTableStateChange]();
        }
      },
      onRowSelectionChange: (updaterOrValue) => {
        const oldState = this.store.state.tableState.rowSelection;
        const newState = functionalUpdate(updaterOrValue, oldState);

        this.store.setState((prev) => ({
          ...prev,
          tableState: { ...prev.tableState, rowSelection: newState },
        }));

        if (this.#rowSelectionManager) {
          const selectedValues = Object.keys(newState);
          const valueToSend = selectedValues.length > 0 ? selectedValues : null;
          this.#rowSelectionManager.select(valueToSend);
        }
      },
      manualPagination: true,
      manualSorting: true,
      manualFiltering: true,
      rowCount: state.totalRows,
      ...state.tableOptions,
      _features: [
        ...(Array.isArray(state.tableOptions._features)
          ? state.tableOptions._features
          : []),
        createMosaicFeature(this),
        createGroupedTableFeature(this),
      ],
    };
  }

  getFacetedUniqueValues<TData extends RowData>(): (
    table: Table<TData>,
    columnId: string,
  ) => () => Map<any, number> {
    return (_table, columnId) => {
      return () => {
        const values = this.getFacetValue<Array<unknown>>(
          columnId,
          Array.isArray,
        );
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
    return this.#store;
  }

  // --- Facet Accessors ---

  getFacets(): Map<string, unknown> {
    return this.#facetValues;
  }

  getFacetValue<T>(
    columnId: string,
    guard?: (val: unknown) => val is T,
  ): T | undefined {
    const val = this.#facetValues.get(columnId);

    if (val === undefined) {
      return undefined;
    }

    if (guard && !guard(val)) {
      logger.error('Core', `Facet type mismatch for column ${columnId}`);
      return undefined;
    }

    return val as unknown as T;
  }

  updateFacetValue(columnId: string, value: unknown) {
    this.#facetValues.set(columnId, value);
    batch(() => {
      this.store.setState((prev) => ({
        ...prev,
        _facetsUpdateCount: prev._facetsUpdateCount + 1,
      }));
    });
  }

  updateTotalRows(count: number) {
    // Ensure we always store a clean Javascript Number, never a BigInt
    // to prevent crashes in UI calculations.
    const safeCount = typeof count === 'bigint' ? Number(count) : count;

    batch(() => {
      this.store.setState((prev) => ({
        ...prev,
        totalRows: safeCount,
      }));
    });
  }

  getColumnSqlName(columnId: string): string | undefined {
    const mapper = this.#columnMapper;
    return mapper?.getSqlColumn(columnId)?.toString();
  }

  getColumnDef(sqlColumn: string): ColumnDef<TData, TValue> | undefined {
    const mapper = this.#columnMapper;
    return mapper?.getColumnDef(sqlColumn);
  }

  get isEnabled() {
    return this.isConnected && this.enabled;
  }

  // ===========================================================================
  // Grouped-mode private methods
  // ===========================================================================

  #handleGroupedQueryResult(table: unknown): this {
    if (!isArrowTable(table)) {
      return this;
    }

    const rawRows = arrowTableToObjects(table);
    this.#groupedRootRows = rawRows.map((raw) =>
      this.#toFlatGroupedRow(raw, 0, {}),
    );

    batch(() => {
      this.store.setState((prev) => ({
        ...prev,
        _grouped: {
          ...prev._grouped,
          isRootLoading: false as boolean,
          totalRootRows: this.#groupedRootRows.length,
        },
      }));
    });

    this.#refreshExpandedChildren();
    this.#rebuildGroupedTree();
    return this;
  }

  #getGroupedTableOptions(
    state: MosaicDataTableStore<TData, TValue>,
  ): TableOptions<TData> {
    const groupBy = this.options.groupBy!;

    const userFeatures = Array.isArray(state.tableOptions._features)
      ? state.tableOptions._features
      : [];
    const features = [
      ...userFeatures,
      createMosaicFeature(this),
      createGroupedTableFeature(this),
    ];

    // Merge user columns with auto-generated leaf columns
    const columns =
      this.#autoLeafColumnDefs.length > 0
        ? ([...state.columnDefs, ...this.#autoLeafColumnDefs] as Array<
            ColumnDef<TData, any>
          >)
        : state.columnDefs;

    // Determine which columns are always visible (metrics + group levels)
    const alwaysVisibleKeys = new Set([
      ...groupBy.metrics.map((m) => m.id),
      ...groupBy.levels.map((l) => l.column),
    ]);

    // Leaf columns are hidden until a leaf row is actually visible.
    // Only toggle columns with accessorKey — custom cell columns (like the
    // expand toggle) have no accessorKey and stay visible always.
    const leafVisible = this.#hasExpandedLeafRows();
    const columnVisibility: Record<string, boolean> = {};
    for (const col of columns) {
      const accessorKey = (
        col as ColumnDef<TData, any> & { accessorKey?: string }
      ).accessorKey;
      if (accessorKey && !alwaysVisibleKeys.has(accessorKey)) {
        columnVisibility[accessorKey] = leafVisible;
      }
    }

    return {
      data: state.rows,
      columns,
      state: {
        expanded: state._grouped.expanded,
        columnVisibility,
      },
      onExpandedChange: (updater: Updater<ExpandedState>) =>
        this.#handleExpandedChange(updater),
      getSubRows: (row) => {
        const meta = (row as unknown as FlatGroupedRow)._groupMeta;
        if (meta.type === 'group') {
          return (row as unknown as FlatGroupedRow).subRows as
            | Array<TData>
            | undefined;
        }
        return undefined;
      },
      getRowId: (row) => (row as unknown as FlatGroupedRow)._groupMeta.id,
      getRowCanExpand: (row) => {
        const meta = (row.original as unknown as FlatGroupedRow)._groupMeta;
        return meta.type === 'group';
      },
      getCoreRowModel: getCoreRowModel(),
      getExpandedRowModel: getExpandedRowModel(),
      manualPagination: true,
      manualSorting: true,
      ...state.tableOptions,
      _features: features,
    } as TableOptions<TData>;
  }

  #handleExpandedChange(updater: Updater<ExpandedState>): void {
    const oldExpanded = this.store.state._grouped.expanded;
    const newExpanded = functionalUpdate(updater, oldExpanded);

    const newlyExpanded = findNewlyExpandedKeys(oldExpanded, newExpanded);

    this.store.setState((prev) => ({
      ...prev,
      _grouped: { ...prev._grouped, expanded: newExpanded },
    }));

    this.#handleCollapses(oldExpanded, newExpanded);

    for (const rowId of newlyExpanded) {
      this.#loadChildrenIfNeeded(rowId);
    }
  }

  #handleCollapses(
    oldExpanded: ExpandedState,
    newExpanded: ExpandedState,
  ): void {
    const oldKeys = getExpandedKeys(oldExpanded);
    const collapsedKeys = oldKeys.filter((k) => !isKeyExpanded(newExpanded, k));

    if (collapsedKeys.length === 0) {
      return;
    }

    this.store.setState((prev) => {
      if (prev._grouped.expanded === true) {
        return prev;
      }
      const nextExpanded = { ...prev._grouped.expanded } as Record<
        string,
        boolean
      >;

      for (const collapsedId of collapsedKeys) {
        delete nextExpanded[collapsedId];
        for (const k of Object.keys(nextExpanded)) {
          if (k.startsWith(collapsedId + GROUP_ID_SEPARATOR)) {
            delete nextExpanded[k];
          }
        }
      }

      return {
        ...prev,
        _grouped: { ...prev._grouped, expanded: nextExpanded },
      };
    });

    if (this.options.rowSelection?.selection) {
      const sel = this.options.rowSelection.selection;
      const currentVal = sel.value as Array<string> | null;
      if (currentVal) {
        const shouldClear = collapsedKeys.some((collapsedId) =>
          currentVal.some(
            (v) =>
              v.startsWith(collapsedId + GROUP_ID_SEPARATOR) &&
              v !== collapsedId,
          ),
        );
        if (shouldClear) {
          sel.update({
            source: this,
            value: null,
            predicate: null,
          });
        }
      }
    }

    this.#rebuildGroupedTree();
  }

  async #loadChildrenIfNeeded(rowId: string): Promise<void> {
    if (this.#childrenCache.has(rowId)) {
      this.#rebuildGroupedTree();
      return;
    }

    const row = this.#findGroupedRowById(rowId);
    if (!row || row._groupMeta.type !== 'group') {
      return;
    }

    this.#setGroupLoading(rowId, true);

    try {
      const filterPredicate = this.#getGroupedFilterPredicate();
      const meta = row._groupMeta;
      const constraints = {
        ...meta.parentConstraints,
        [meta.groupColumn!]: meta.groupValue!,
      };

      const children = meta.isLeafParent
        ? await this.#queryGroupLeafRows(constraints, filterPredicate)
        : await this.#queryGroupLevel(
            meta.depth + 1,
            constraints,
            filterPredicate,
          );

      this.#childrenCache.set(rowId, children);

      // Auto-generate leaf column defs on first leaf load
      if (
        meta.isLeafParent &&
        children.length > 0 &&
        this.#autoLeafColumnDefs.length === 0
      ) {
        this.#generateAutoLeafColumns(children[0]!);
      }
    } catch (e) {
      logger.warn('Grouped', `Failed to load children for ${rowId}`, {
        error: e,
      });
      this.#childrenCache.set(rowId, []);
    } finally {
      this.#setGroupLoading(rowId, false);
    }

    this.#rebuildGroupedTree();
  }

  async #refreshExpandedChildren(): Promise<void> {
    const expandedKeys = getExpandedKeys(this.store.state._grouped.expanded);
    if (expandedKeys.length === 0) {
      return;
    }

    const filterPredicate = this.#getGroupedFilterPredicate();
    const validRootIds = new Set(
      this.#groupedRootRows.map((r) => r._groupMeta.id),
    );
    const groupBy = this.options.groupBy!;

    const queries: Array<{
      parentId: string;
      promise: Promise<Array<FlatGroupedRow>>;
    }> = [];

    for (const key of expandedKeys) {
      if (key.includes('_leaf_')) {
        continue;
      }

      const row = this.#findGroupedRowById(key);
      if (row && row._groupMeta.type === 'group') {
        const rootSegment = key.split(GROUP_ID_SEPARATOR)[0]!;
        if (!validRootIds.has(rootSegment)) {
          continue;
        }

        const meta = row._groupMeta;
        const constraints = {
          ...meta.parentConstraints,
          [meta.groupColumn!]: meta.groupValue!,
        };

        if (meta.isLeafParent) {
          queries.push({
            parentId: key,
            promise: this.#queryGroupLeafRows(constraints, filterPredicate),
          });
        } else {
          queries.push({
            parentId: key,
            promise: this.#queryGroupLevel(
              meta.depth + 1,
              constraints,
              filterPredicate,
            ),
          });
        }
        continue;
      }

      // Row not found — try to reconstruct from ID segments
      const hasLeafColumns =
        !!groupBy.leafColumns && groupBy.leafColumns.length > 0;
      const segments = key.split(GROUP_ID_SEPARATOR);
      const depth = segments.length - 1;

      const isLeafParentRow =
        depth === groupBy.levels.length - 1 && hasLeafColumns;
      if (isLeafParentRow) {
        continue;
      }
      if (depth >= groupBy.levels.length - 1) {
        continue;
      }

      const rootSegment = segments[0]!;
      if (!validRootIds.has(rootSegment)) {
        continue;
      }

      const constraints: Record<string, string> = {};
      for (let i = 0; i <= depth; i++) {
        constraints[groupBy.levels[i]!.column] = segments[i]!;
      }

      queries.push({
        parentId: key,
        promise: this.#queryGroupLevel(depth + 1, constraints, filterPredicate),
      });
    }

    const results = await Promise.allSettled(
      queries.map(async (q) => ({
        parentId: q.parentId,
        children: await q.promise,
      })),
    );

    const newCache = new Map<string, Array<FlatGroupedRow>>();
    for (const result of results) {
      if (result.status === 'fulfilled') {
        newCache.set(result.value.parentId, result.value.children);
      }
    }
    this.#childrenCache = newCache;

    // Prune expanded state for invalid roots
    const prevExpanded = this.store.state._grouped.expanded;
    if (prevExpanded !== true) {
      const pruned: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(prevExpanded)) {
        const rootSegment = k.split(GROUP_ID_SEPARATOR)[0]!;
        if (v && validRootIds.has(rootSegment)) {
          pruned[k] = true;
        }
      }
      this.store.setState((prev) => ({
        ...prev,
        _grouped: { ...prev._grouped, expanded: pruned },
      }));
    }

    this.#rebuildGroupedTree();
  }

  #rebuildGroupedTree(): void {
    const cache = this.#childrenCache;

    function attachChildren(
      rows: Array<FlatGroupedRow>,
    ): Array<FlatGroupedRow> {
      return rows.map((row) => {
        if (row._groupMeta.type === 'leaf') {
          return row;
        }

        const cachedChildren = cache.get(row._groupMeta.id);
        if (cachedChildren && cachedChildren.length > 0) {
          return { ...row, subRows: attachChildren(cachedChildren) };
        }

        return { ...row, subRows: [] as Array<FlatGroupedRow> };
      });
    }

    const treeData = attachChildren(this.#groupedRootRows);
    batch(() => {
      this.store.setState((prev) => ({
        ...prev,
        rows: treeData as Array<TData>,
      }));
    });
  }

  #toFlatGroupedRow(
    raw: Record<string, unknown>,
    depth: number,
    parentConstraints: Record<string, string>,
  ): FlatGroupedRow {
    const groupBy = this.options.groupBy!;
    const hasLeafColumns =
      !!groupBy.leafColumns && groupBy.leafColumns.length > 0;
    const level = groupBy.levels[depth]!;
    const value = String(raw[level.column] ?? '');

    const isDeepestLevel = depth === groupBy.levels.length - 1;
    const isLeafParent = isDeepestLevel && hasLeafColumns;

    const parentChain = Object.values(parentConstraints);
    const id =
      parentChain.length > 0
        ? `${parentChain.join(GROUP_ID_SEPARATOR)}${GROUP_ID_SEPARATOR}${value}`
        : value;

    return {
      ...raw,
      _groupMeta: {
        type: 'group',
        id,
        depth,
        parentConstraints: { ...parentConstraints },
        groupColumn: level.column,
        groupValue: value,
        isLeafParent,
      },
      subRows: [],
    };
  }

  #toFlatLeafRow(
    raw: Record<string, unknown>,
    parentConstraints: Record<string, string>,
    index: number,
  ): FlatGroupedRow {
    const parentChain = Object.values(parentConstraints);
    const uniqueId = raw.unique_key ?? `row_${index}`;
    const id =
      parentChain.length > 0
        ? `${parentChain.join(GROUP_ID_SEPARATOR)}${GROUP_ID_SEPARATOR}_leaf_${uniqueId}`
        : `_leaf_${uniqueId}`;

    const depth = Object.keys(parentConstraints).length;

    return {
      ...raw,
      _groupMeta: {
        type: 'leaf',
        id,
        depth,
        parentConstraints: { ...parentConstraints },
      },
    };
  }

  async #queryGroupLevel(
    depth: number,
    parentConstraints: Record<string, string>,
    filterPredicate: FilterExpr | null,
  ): Promise<Array<FlatGroupedRow>> {
    const groupBy = this.options.groupBy!;

    const query = buildGroupedLevelQuery({
      table: this.source as string,
      groupBy: groupBy.levels,
      depth,
      metrics: groupBy.metrics,
      parentConstraints,
      filterPredicate,
      additionalWhere: groupBy.additionalWhere ?? undefined,
      limit: groupBy.pageSize ?? 200,
    });

    const result = await this.coordinator!.query(query.toString());
    const rawRows = arrowTableToObjects(result);

    return rawRows.map((raw) =>
      this.#toFlatGroupedRow(raw, depth, parentConstraints),
    );
  }

  async #queryGroupLeafRows(
    parentConstraints: Record<string, string>,
    filterPredicate: FilterExpr | null,
  ): Promise<Array<FlatGroupedRow>> {
    const groupBy = this.options.groupBy!;

    if (!groupBy.leafColumns || groupBy.leafColumns.length === 0) {
      return [];
    }

    const query = buildLeafRowsQuery({
      table: this.source as string,
      leafColumns: groupBy.leafColumns,
      parentConstraints,
      filterPredicate,
      additionalWhere: groupBy.additionalWhere ?? undefined,
      limit: groupBy.leafPageSize ?? 50,
      selectAll: groupBy.leafSelectAll ?? false,
    });

    const result = await this.coordinator!.query(query.toString());
    const rawRows = arrowTableToObjects(result);

    return rawRows.map((raw, idx) =>
      this.#toFlatLeafRow(raw, parentConstraints, idx),
    );
  }

  #findGroupedRowById(rowId: string): FlatGroupedRow | null {
    function search(rows: Array<FlatGroupedRow>): FlatGroupedRow | null {
      for (const row of rows) {
        if (row._groupMeta.id === rowId) {
          return row;
        }
        if (row._groupMeta.type === 'group' && row.subRows) {
          const found = search(row.subRows);
          if (found) {
            return found;
          }
        }
      }
      return null;
    }

    const fromRoot = search(this.#groupedRootRows);
    if (fromRoot) {
      return fromRoot;
    }

    for (const children of this.#childrenCache.values()) {
      const found = search(children);
      if (found) {
        return found;
      }
    }

    return null;
  }

  #setGroupLoading(groupId: string, loading: boolean): void {
    this.store.setState((prev) => {
      const ids = prev._grouped.loadingGroupIds;
      const next = loading
        ? ids.includes(groupId)
          ? ids
          : [...ids, groupId]
        : ids.filter((id) => id !== groupId);
      return {
        ...prev,
        _grouped: { ...prev._grouped, loadingGroupIds: next },
      };
    });
  }

  #getGroupedFilterPredicate(): FilterExpr | null {
    return (this.filterBy?.predicate(null) as FilterExpr | null) ?? null;
  }

  /**
   * Check if any currently-expanded row has leaf children visible.
   * Used to toggle column visibility for leaf-specific columns.
   */
  #hasExpandedLeafRows(): boolean {
    const expanded = this.store.state._grouped.expanded;
    if (expanded === true) {
      return false;
    }

    for (const [key, isExpanded] of Object.entries(expanded)) {
      if (!isExpanded) {
        continue;
      }
      const cached = this.#childrenCache.get(key);
      if (
        cached &&
        cached.length > 0 &&
        cached[0]!._groupMeta.type === 'leaf'
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Auto-generate column defs for leaf row keys not already covered by
   * user-provided columns. Uses `leafColumns` labels when available,
   * falls back to the raw key name.
   */
  #generateAutoLeafColumns(sampleRow: FlatGroupedRow): void {
    const existingKeys = new Set(
      this.store.state.columnDefs
        .map(
          (c) =>
            (c as ColumnDef<TData, any> & { accessorKey?: string })
              .accessorKey ?? c.id,
        )
        .filter(Boolean),
    );

    const groupBy = this.options.groupBy!;

    // Also exclude metric IDs and level columns — those are group columns
    const groupKeys = new Set([
      ...groupBy.metrics.map((m) => m.id),
      ...groupBy.levels.map((l) => l.column),
    ]);

    const leafKeys = Object.keys(sampleRow).filter(
      (k) =>
        k !== '_groupMeta' &&
        k !== 'subRows' &&
        !existingKeys.has(k) &&
        !groupKeys.has(k),
    );

    this.#autoLeafColumnDefs = leafKeys.map((k) => {
      const leafCol = groupBy.leafColumns?.find((lc) => lc.column === k);
      return {
        accessorKey: k,
        header: leafCol?.label ?? k,
      } as ColumnDef<TData, any>;
    });
  }

  // --- Grouped-mode public accessors ---

  get isGroupedMode(): boolean {
    return this.#isGrouped;
  }

  /**
   * Reactive derived store for grouped-mode state.
   * Use with `useStore` in React for subscribed updates:
   *
   *   const grouped = useStore(client.groupedStore, (s) => s)
   *
   * Or use the convenience hook `useGroupedTableState(client)`.
   */
  get groupedStore(): ReadonlyStore<
    MosaicDataTableStore<TData, TValue>['_grouped']
  > {
    return this.#groupedStore;
  }

  /** Snapshot read of grouped state. Not reactive — prefer `groupedStore` in UI. */
  get groupedState() {
    return this.#groupedStore.state;
  }

  isRowLoading(rowId: string): boolean {
    return this.store.state._grouped.loadingGroupIds.includes(rowId);
  }
}
