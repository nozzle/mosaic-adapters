/**
 * The core Orchestrator for the Mosaic <-> TanStack Table integration.
 * Manages state, schema mapping, query generation, and facet sidecars.
 */

import {
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
import { BaseMosaicClient } from './base-client';
import { SidecarManager } from './sidecar-manager';

import type { FieldInfo, FieldInfoRequest } from '@uwdata/mosaic-core';
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

/**
 * A Mosaic Client that does the glue work to drive TanStack Table, using it's
 * TableOptions for configuration.
 */
export class MosaicDataTable<
  TData extends RowData,
  TValue = unknown,
> extends BaseMosaicClient {
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
  public sidecarManager = new SidecarManager<TData, TValue>(this);
  #facetValues: Map<string, any> = new Map();

  // Manager for row selection sync
  #rowSelectionManager?: MosaicSelectionManager;

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
        // Configured explicitly via columnType, or defaults to scalar if undefined
        columnType: options.rowSelection.columnType,
      });
    } else {
      this.#rowSelectionManager = undefined;
    }

    // Robustly resolve the coordinator.
    // 1. Try options.coordinator
    // 2. Try existing this.coordinator
    // 3. Fallback to defaultCoordinator()
    const resolvedCoordinator =
      options.coordinator || this.coordinator || defaultCoordinator();

    // BaseMosaicClient handles the safe swapping via setCoordinator
    this.setCoordinator(resolvedCoordinator);
    this.sidecarManager.updateCoordinators(resolvedCoordinator);

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

      this.sidecarManager.requestFacet(colId, facetType);
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
    return this.options.__debugName ? `${this.options.__debugName}:` : '';
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

  // Hook from BaseMosaicClient
  protected override onConnect() {
    this.enabled = true;

    // Connect active facet clients (Sidecar Clients)
    this.sidecarManager.connectAll();
    // Refresh them to ensure they have the latest data
    this.sidecarManager.refreshAll();

    const selectionCb = () => {
      // Check if the active update came from US (cross-filtering).
      const activeClause =
        this.filterBy?.active || this.options.highlightBy?.active;

      const isSelfUpdate = activeClause?.source === this;

      // 1. Reset Pagination ONLY if the update is external.
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
    this.options.highlightBy?.addEventListener('value', selectionCb);

    if (this.options.rowSelection?.selection) {
      this.options.rowSelection.selection.addEventListener(
        'value',
        rowSelectionCb,
      );
      // Initialize state immediately
      rowSelectionCb();
    }

    // Store cleanup for onDisconnect
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

  protected override onDisconnect() {
    this._cleanupListener?.();
  }

  destroy(): void {
    super.destroy();
    this.sidecarManager.clear();
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
            this.sidecarManager.refreshAll();
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

  // --- Exposed Helpers for SidecarManager ---

  /**
   * Returns the SQL column name for a given TanStack Column ID.
   */
  getColumnSqlName(columnId: string): string | undefined {
    return this.#columnMapper.getSqlColumn(columnId);
  }

  /**
   * Returns the ColumnDef for a given SQL column name.
   */
  getColumnDef(sqlColumn: string): ColumnDef<TData, TValue> | undefined {
    return this.#columnMapper.getColumnDef(sqlColumn);
  }

  /**
   * Updates the facet value for a column and triggers a store update.
   */
  updateFacetValue(columnId: string, value: any) {
    this.#facetValues.set(columnId, value);
    batch(() => {
      this.#store.setState((prev) => ({
        ...prev,
        _facetsUpdateCount: prev._facetsUpdateCount + 1,
      }));
    });
  }

  get isEnabled() {
    return this.isConnected;
  }
}
