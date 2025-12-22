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
 * Factory function to create a MosaicDataTable client.
 */
export function createMosaicDataTableClient<
  TData extends RowData,
  TValue = unknown,
>(options: MosaicDataTableOptions<TData, TValue>) {
  const client = new MosaicDataTable<TData, TValue>(options);
  return client;
}

/**
 * A Mosaic Client that handles data fetching and coordination for TanStack Table.
 */
export class MosaicDataTable<
  TData extends RowData,
  TValue = unknown,
> extends BaseMosaicClient {
  source: MosaicTableSource;
  schema: Array<FieldInfo> = [];
  tableFilterSelection?: Selection;
  options: MosaicDataTableOptions<TData, TValue>;

  #store?: Store<MosaicDataTableStore<TData, TValue>>;
  #sql_total_rows = toSafeSqlColumnName('__total_rows');
  #onTableStateChange: 'requestQuery' | 'requestUpdate' = 'requestUpdate';

  #columnMapper: ColumnMapper<TData, TValue> | undefined;

  public sidecarManager = new SidecarManager<TData, TValue>(this);
  #facetValues: Map<string, any> = new Map();

  #rowSelectionManager?: MosaicSelectionManager;

  constructor(options: MosaicDataTableOptions<TData, TValue>) {
    super(options.filterBy);
    this.options = options;
    this.source = options.table;

    this.updateOptions(options);
  }

  updateOptions(options: MosaicDataTableOptions<TData, TValue>): void {
    const sourceChanged = this.source !== options.table;

    this.options = options;

    if (options.onTableStateChange) {
      this.#onTableStateChange = options.onTableStateChange;
    }

    this.source = options.table;

    if (options.tableFilterSelection) {
      this.tableFilterSelection = options.tableFilterSelection;
    } else if (!this.tableFilterSelection) {
      this.tableFilterSelection = new Selection();
    }

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

    if (options.columns) {
      this.#columnMapper = new ColumnMapper(options.columns);
      this.#initializeAutoFacets(options.columns);
    } else if (sourceChanged) {
      this.#columnMapper = undefined;
      this.schema = [];

      if (this.isConnected) {
        this.prepare().then(() => {
          this.requestUpdate();
        });
      }
    }
  }

  #initializeAutoFacets(columns: Array<ColumnDef<TData, TValue>>) {
    // Lazy facets enabled - registration happens in UI
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

    const statement = this.#columnMapper
      ? buildTableQuery({
          source,
          tableState,
          mapper: this.#columnMapper,
          totalRowsColumnName: this.#sql_total_rows,
          highlightPredicate: safeHighlightPredicate,
          manualHighlight: this.options.manualHighlight,
        })
      : mSql.Query.from(source).select('*');

    if (
      effectiveFilter &&
      typeof this.source === 'string' &&
      this.#columnMapper
    ) {
      statement.where(effectiveFilter);
    }

    if (this.#columnMapper && this.tableFilterSelection) {
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
    }

    // MEMORY OPTIMIZATION: Trigger split count query
    this.#fetchTotalRows(primaryFilter);

    return statement;
  }

  /**
   * Optimized secondary query to fetch the total row count without window functions.
   */
  async #fetchTotalRows(primaryFilter?: FilterExpr | null) {
    if (!this.coordinator || !this.#columnMapper) {
      return;
    }

    const source = this.resolveSource(primaryFilter);
    const tableState = this.store.state.tableState;

    const internalClauses = extractInternalFilters({
      tableState,
      mapper: this.#columnMapper,
    });

    const query = mSql.Query.from(source).select({ count: mSql.count() });

    if (primaryFilter) {
      query.where(primaryFilter);
    }
    if (internalClauses.length > 0) {
      query.where(...internalClauses);
    }

    try {
      const result = await this.coordinator.query(query.toString());
      if (isArrowTable(result) && result.numRows > 0) {
        const count = Number(result.get(0).count);
        this.store.setState((prev) => ({ ...prev, totalRows: count }));
      }
    } catch (e) {
      logger.error('SQL', 'Failed to fetch split row count', { error: e });
    }
  }

  public getCascadingFilters(options: {
    excludeColumnId: string;
  }): Array<mSql.FilterExpr> {
    if (!this.#columnMapper) {
      return [];
    }

    const tableState = this.store.state.tableState;

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
      const rows = table.toArray() as Array<TData>;

      batch(() => {
        this.store.setState((prev) => {
          return {
            ...prev,
            rows,
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

      if (!this.#columnMapper && schema.length > 0) {
        const inferredColumns = schema.map((s) => ({
          accessorKey: s.column,
          id: s.column,
        }));
        this.#columnMapper = new ColumnMapper(inferredColumns as any);
      }
    }
    return Promise.resolve();
  }

  protected override onConnect() {
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

  protected override onDisconnect() {
    this._cleanupListener?.();
  }

  destroy(): void {
    super.destroy();
    this.sidecarManager.clear();
  }

  fields(): Array<FieldInfoRequest> {
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
    if (!this.#store) {
      throw new Error(
        'MosaicDataTable: store accessed before initialization. updateOptions must be called.',
      );
    }
    return this.#store;
  }

  getFacets(): Map<string, any> {
    return this.#facetValues;
  }

  getColumnSqlName(columnId: string): string | undefined {
    return this.#columnMapper?.getSqlColumn(columnId);
  }

  getColumnDef(sqlColumn: string): ColumnDef<TData, TValue> | undefined {
    return this.#columnMapper?.getColumnDef(sqlColumn);
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

  get isEnabled() {
    return this.isConnected;
  }
}
