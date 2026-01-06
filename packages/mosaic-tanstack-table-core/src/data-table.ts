/**
 * Orchestrator for the Mosaic and TanStack Table integration.
 * Manages the data-fetching lifecycle, schema mapping, and reactive state synchronization.
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
import { MosaicSelectionManager } from './selection-manager';
import { createLifecycleManager, handleQueryError } from './client-utils';
import { SidecarManager } from './sidecar-manager';
import { StrategyRegistry } from './registry';
import { defaultFilterStrategies } from './query/filter-factory';
import { defaultFacetStrategies } from './facet-strategies';

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
  IMosaicClient,
  MosaicDataTableOptions,
  MosaicDataTableStore,
  MosaicTableSource,
} from './types';
import type { FilterStrategy } from './query/filter-factory';
import type { FacetStrategy } from './facet-strategies';

let instanceCounter = 0;

/**
 * Factory function to create a MosaicDataTable client.
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
  const client = new MosaicDataTable<TData, TValue>(options);
  return client;
}

/**
 * A Mosaic Client that provides the coordination logic to drive TanStack Table.
 */
export class MosaicDataTable<TData extends RowData, TValue = unknown>
  extends MosaicClient
  implements IMosaicClient
{
  public readonly id: number;
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
  public facetRegistry: StrategyRegistry<FacetStrategy<any>>;

  #facetValues: Map<string, any> = new Map();

  #rowSelectionManager?: MosaicSelectionManager;

  private lifecycle = createLifecycleManager(this);

  constructor(options: MosaicDataTableOptions<TData, TValue>) {
    super(options.filterBy);
    this.id = ++instanceCounter;
    this.options = options;
    this.source = options.table;

    // Initialize Registries
    this.filterRegistry = new StrategyRegistry({
      ...defaultFilterStrategies,
      ...options.filterStrategies,
    });

    this.facetRegistry = new StrategyRegistry({
      ...defaultFacetStrategies,
      ...options.facetStrategies,
    });

    // Initialize Sidecar Manager with reference to this host and the registry
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

  /**
   * Safe wrapper for requestQuery.
   * Uses super.requestQuery to ensure the library's client-coordinator handshake is preserved.
   */
  override requestQuery(query?: any): Promise<any> | null {
    if (!this.coordinator) {
      return Promise.resolve();
    }
    return super.requestQuery(query);
  }

  override queryError(error: Error): this {
    handleQueryError(`MosaicDataTable #${this.id}`, error);
    return this;
  }

  /**
   * Updates internal state and store when options change.
   * @param options The updated options.
   */
  updateOptions(options: MosaicDataTableOptions<TData, TValue>): void {
    // Detect if the table source has changed to trigger re-preparation
    const sourceChanged = this.source !== options.table;

    this.options = options;

    if (options.onTableStateChange) {
      this.#onTableStateChange = options.onTableStateChange;
    }

    this.source = options.table;

    // Re-register custom strategies if they changed (overwriting existing ones)
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

    // Guaranteed initialization: uses provided selection, or falls back to an internal default.
    const currentSelection = (this as any).tableFilterSelection as
      | Selection
      | undefined;
    this.tableFilterSelection =
      options.tableFilterSelection ?? currentSelection ?? new Selection();

    if (options.rowSelection) {
      this.#rowSelectionManager = new MosaicSelectionManager({
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

    // Type cast to check if the private store is initialized yet
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
      });
    } else {
      // If we have explicit columns, update them immediately.
      if (options.columns !== undefined) {
        this.#store.setState((prev) => ({
          ...prev,
          columnDefs: options.columns!,
        }));
      }
    }

    // Split Mode Logic: Spin up a sidecar for total counts
    if (options.totalRowsMode === 'split') {
      this.sidecarManager.requestTotalCount();
    }

    // If explicit columns are provided, initialize the mapper immediately
    if (options.columns) {
      // Diagnostic Log
      if (options.__debugName?.includes('DetailTable')) {
        logger.debug(
          'Core',
          `[MosaicDataTable #${this.id}] Updating Columns. Count: ${options.columns.length}`,
        );
      }

      this.#columnMapper = new ColumnMapper(options.columns, options.mapping);
      this.#initializeAutoFacets(options.columns);
    }
    // If source changed and we are in dynamic mode (no explicit columns),
    // clear the old schema and re-prepare
    else if (sourceChanged) {
      this.schema = [];

      // CRITICAL FIX: Reset the column mapper immediately.
      // This prevents the client from generating queries using the OLD schema against the NEW table
      // (which causes "Binder Error: Referenced column not found" errors).
      this.#columnMapper = undefined;

      // Also reset the store to prevent the UI from rendering stale columns
      this.#store.setState((prev) => ({
        ...prev,
        columnDefs: [],
        rows: [],
      }));

      if (this.isConnected) {
        // Re-run the preparation phase to infer new schema
        this.prepare().then(() => {
          this.requestUpdate();
        });
      }
    }
  }

  /**
   * Initializes facet sidecars based on column metadata.
   */
  #initializeAutoFacets(columns: Array<ColumnDef<TData, TValue>>) {
    columns.forEach((col) => {
      const facetType = col.meta?.mosaicDataTable?.facet;
      const colId = col.id;

      if (!facetType || !colId) {
        return;
      }

      this.sidecarManager.requestFacet(colId, facetType);
    });
  }

  /**
   * Request auxiliary data (Sidecars) linked to this table's context.
   * Useful for generating Histograms, Heatmaps, or other aggregates driven by the table's filters.
   */
  public requestAuxiliary(config: {
    id: string;
    type: string;
    column: string;
    excludeColumnId?: string;
    options?: Record<string, any>;
    onResult?: (result: any) => void;
  }) {
    this.sidecarManager.requestAuxiliary(config);
  }

  /**
   * Resolves the polymorphic data source into a SQL string or query object.
   */
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

    let effectiveFilter = hardFilter;
    if (crossFilterPredicate) {
      effectiveFilter = effectiveFilter
        ? mSql.and(effectiveFilter, crossFilterPredicate)
        : crossFilterPredicate;
    }

    const safeHighlightPredicate = crossFilterPredicate
      ? null
      : highlightPredicate;

    const tableState = this.store.state.tableState;

    // Use current mapper if initialized, otherwise generate raw select.
    const mapper = this.#columnMapper;

    const statement = mapper
      ? buildTableQuery({
          source,
          tableState,
          mapper: mapper,
          mapping: this.options.mapping,
          totalRowsColumnName: this.#sql_total_rows,
          highlightPredicate: safeHighlightPredicate,
          manualHighlight: this.options.manualHighlight,
          totalRowsMode: this.options.totalRowsMode,
          filterRegistry: this.filterRegistry,
        })
      : mSql.Query.from(source).select('*', {
          [this.#sql_total_rows]: mSql.sql`COUNT(*) OVER()`,
        });

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
    }

    return statement;
  }

  /**
   * Generates filters for cascading selection logic.
   * If excludeColumnId is omitted, returns all filters (used for Total Count).
   */
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

    // Cast to check if mapper is ready
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
    if (isArrowTable(table)) {
      let totalRows: number | undefined = undefined;

      // FIX: Explicitly type as any[] to avoid strict type mismatch with TData[]
      // when reassigning after validation/casting.
      let rows: Array<any> = table.toArray();

      // --- RUNTIME SCHEMA VALIDATION ---
      const mode = this.options.validationMode ?? 'first';
      const schema = this.options.schema;

      if (mode !== 'none' && rows.length > 0) {
        try {
          if (mode === 'first') {
            // Validate first row
            schema.parse(rows[0]);
            // Trust the rest - cast to TData explicitly
            rows = rows as unknown as Array<TData>;
          } else {
            // mode === 'all' is implicit if not 'first' and not 'none' here
            // Validate all
            rows = rows.map((r) => schema.parse(r));
          }
        } catch (err) {
          // --- SOFT FAIL ---
          // Instead of returning empty rows (which breaks the UI), we warn the developer
          // but proceed with the "best effort" raw data.
          // This allows debugging of what actually came back from the DB vs what was expected.
          logger.warn(
            'Core',
            `[MosaicDataTable ${this.debugPrefix}] Schema Mismatch (Soft Fail). Proceeding with raw data.`,
            {
              error: err,
              expectedSchema: schema,
              receivedRowSample: rows[0],
            },
          );
          // Do NOT clear rows. Proceed with the raw data.
          // rows = []; // <--- DISABLED HARD FAIL
        }
      }

      // Cast to TData array (via unknown first if needed by TS in some contexts)
      const typedRows = rows as unknown as Array<TData>;

      if (
        this.options.totalRowsMode === 'window' &&
        typedRows.length > 0 &&
        typedRows[0] &&
        typeof typedRows[0] === 'object' &&
        this.#sql_total_rows in typedRows[0]
      ) {
        const firstRow = typedRows[0] as Record<string, any>;
        totalRows = firstRow[this.#sql_total_rows];
      }

      batch(() => {
        this.store.setState((prev) => {
          return {
            ...prev,
            rows: typedRows,
            // Only overwrite totalRows if we are in window mode or if it's undefined
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

  override async prepare(): Promise<void> {
    const source = this.resolveSource();

    if (!source || (typeof source === 'string' && source.trim() === '')) {
      return Promise.resolve();
    }

    if (typeof source === 'string') {
      const schema = await queryFieldInfo(this.coordinator!, this.fields());
      this.schema = schema;

      // Access private field via any to check initialization
      const mapper = this.#columnMapper;

      // Initialize inferred mapper if we have no column definitions and no existing mapper
      if (schema.length > 0 && this.options.columns === undefined && !mapper) {
        const inferredColumns = schema.map((s) => ({
          accessorKey: s.column,
          id: s.column,
        }));
        // Note: Inference cannot guess mapping, so we pass undefined.
        // This is legacy behavior for quick prototypes.
        this.#columnMapper = new ColumnMapper(inferredColumns as any);
      }
    }
    return Promise.resolve();
  }

  public __onConnect() {
    this.enabled = true;

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

  /**
   * Defines the fields to be queried by Mosaic.
   */
  fields(): Array<FieldInfoRequest> {
    const source = this.resolveSource();

    if (!source || (typeof source === 'string' && source.trim() === '')) {
      return [];
    }

    if (typeof source !== 'string') {
      return [];
    }

    // Access mapper via any to check initialization
    const mapper = this.#columnMapper;

    if (!mapper) {
      return [{ table: source, column: '*' }];
    }

    return mapper.getMosaicFieldRequests(source);
  }

  /**
   * Produces TanStack Table options from internal store state.
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
        const hashedOldState = JSON.stringify(this.store.state.tableState);
        const tableState = functionalUpdate(
          updater,
          this.store.state.tableState,
        );

        this.store.setState((prev) => ({
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

  getColumnSqlName(columnId: string): string | undefined {
    const mapper = this.#columnMapper;
    return mapper?.getSqlColumn(columnId)?.toString();
  }

  getColumnDef(sqlColumn: string): ColumnDef<TData, TValue> | undefined {
    const mapper = this.#columnMapper;
    return mapper?.getColumnDef(sqlColumn);
  }

  updateFacetValue(columnId: string, value: any) {
    this.#facetValues.set(columnId, value);
    batch(() => {
      this.store.setState((prev) => ({
        ...prev,
        _facetsUpdateCount: prev._facetsUpdateCount + 1,
      }));
    });
  }

  updateTotalRows(count: number) {
    batch(() => {
      this.store.setState((prev) => ({
        ...prev,
        totalRows: count,
      }));
    });
  }

  get isEnabled() {
    return this.isConnected;
  }
}
