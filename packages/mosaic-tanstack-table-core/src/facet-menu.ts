import {
  MosaicClient,
  coordinator as defaultCoordinator,
  isParam,
} from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { Store } from '@tanstack/store';
import { createStructAccess } from './utils';
import { logger } from './logger';
import { MosaicSelectionManager } from './selection-manager';
import { createLifecycleManager, handleQueryError } from './client-utils';
import { SqlIdentifier } from './domain/sql-identifier';
import type { Coordinator, Selection } from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { ColumnType, IMosaicClient, MosaicTableSource } from './types';

export type FacetValue = string | number | boolean | Date | null;

export interface MosaicFacetMenuOptions {
  table: MosaicTableSource;
  column: string;
  selection: Selection;
  filterBy?: Selection;
  additionalContext?: Selection;
  coordinator?: Coordinator;
  sortMode?: 'alpha' | 'count';
  limit?: number;
  __debugName?: string;
  columnType?: ColumnType;
  // Deprecated support for old option
  isArrayColumn?: boolean;
  /**
   * Debounce time in milliseconds for search term updates.
   * @default 300
   */
  debounceTime?: number;
  /**
   * Whether the facet client is enabled.
   * If false, the client will not execute queries.
   * @default true
   */
  enabled?: boolean;
}

export interface MosaicFacetMenuState {
  /** Raw options returned from the database query */
  options: Array<FacetValue>;
  /**
   * Smart list of options for UI display.
   * Logic: Union(SelectedValues, DatabaseOptions).
   * Ensures selected items remain visible even if excluded by other filters or pagination limits.
   */
  displayOptions: Array<FacetValue>;
  loading: boolean;
  /** The active search term used for the last query */
  searchTerm: string;
  selectedValues: Array<FacetValue>;
  /** Total number of available options matching the search (if known) */
  hasMore: boolean;
}

/**
 * A "Sidecar" Client for fetching metadata (unique values) independent of the main table query.
 */
export class MosaicFacetMenu extends MosaicClient implements IMosaicClient {
  public options: MosaicFacetMenuOptions;
  readonly store: Store<MosaicFacetMenuState>;
  readonly id: string;

  private selectionManager: MosaicSelectionManager;
  private _searchTerm = '';
  private _currentLimit: number;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private lifecycle = createLifecycleManager(this);

  constructor(options: MosaicFacetMenuOptions) {
    super(options.filterBy);
    this.options = options;
    this.id = Math.random().toString(36).substring(2, 9);
    this.coordinator = options.coordinator || defaultCoordinator();

    // Initialize dynamic limit
    this._currentLimit = options.limit || 50;

    this.store = new Store<MosaicFacetMenuState>({
      options: [],
      displayOptions: [],
      loading: false,
      searchTerm: '',
      selectedValues: [],
      hasMore: true,
    });

    // Initialize Manager
    this.selectionManager = new MosaicSelectionManager({
      selection: options.selection,
      client: this,
      column: options.column,
      columnType:
        options.columnType ?? (options.isArrayColumn ? 'array' : 'scalar'),
    });

    logger.debug('Core', `${this.debugPrefix} Created Instance #${this.id}`);
  }

  get isConnected() {
    return this.lifecycle.isConnected;
  }

  /**
   * Override the base filterBy getter to ensure the Coordinator always sees
   * the most current selection from options.
   */
  override get filterBy() {
    return this.options.filterBy;
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
   * Updates options and handles re-connection/listener updates if needed.
   */
  updateOptions(newOptions: MosaicFacetMenuOptions) {
    const oldOptions = this.options;
    this.options = newOptions;

    // Reset limit if column changes
    if (
      oldOptions.column !== newOptions.column ||
      oldOptions.table !== newOptions.table
    ) {
      this._currentLimit = newOptions.limit || 50;
    }

    // Update coordinator if changed
    const nextCoordinator =
      newOptions.coordinator || this.coordinator || defaultCoordinator();
    this.setCoordinator(nextCoordinator);

    // 1. Handle Primary Filter (filterBy) changes
    if (oldOptions.filterBy !== newOptions.filterBy) {
      this.requestUpdate();
    }

    // 2. Handle additionalContext listeners
    if (oldOptions.additionalContext !== newOptions.additionalContext) {
      if (oldOptions.additionalContext) {
        oldOptions.additionalContext.removeEventListener(
          'value',
          this._additionalContextListener,
        );
      }
      if (newOptions.additionalContext) {
        newOptions.additionalContext.addEventListener(
          'value',
          this._additionalContextListener,
        );
      }
      this.requestUpdate();
    }

    // 3. Handle Enabled State
    if (oldOptions.enabled !== newOptions.enabled && newOptions.enabled) {
      this.requestUpdate();
    }

    // 4. Handle Structural Changes
    if (
      oldOptions.table !== newOptions.table ||
      oldOptions.column !== newOptions.column ||
      oldOptions.selection !== newOptions.selection ||
      oldOptions.columnType !== newOptions.columnType ||
      oldOptions.isArrayColumn !== newOptions.isArrayColumn
    ) {
      this.selectionManager = new MosaicSelectionManager({
        selection: newOptions.selection,
        client: this,
        column: newOptions.column,
        columnType:
          newOptions.columnType ??
          (newOptions.isArrayColumn ? 'array' : 'scalar'),
      });

      if (
        oldOptions.table !== newOptions.table ||
        oldOptions.column !== newOptions.column
      ) {
        this.selectionManager.select(null);
      } else {
        this._syncStoreFromManager();
      }

      this.requestUpdate();
    }
  }

  private _additionalContextListener = () => {
    this.requestUpdate();
  };

  private _selectionListener = () => {
    const active = this.options.selection.active;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (active && active.source === this) {
      return;
    }

    // Detect Global Reset Signal
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const src = active ? (active.source as any) : null;
    const isGlobalReset =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      active &&
      active.value === null &&
      (src === null || src?.id === 'GlobalReset');

    if (isGlobalReset) {
      this.selectionManager.select(null);
      if (this._searchTerm !== '') {
        this._searchTerm = '';
        this.store.setState((s) => ({ ...s, searchTerm: '' }));
        // Reset limit on clear
        this._currentLimit = this.options.limit || 50;
        this.requestUpdate();
      }
      this._syncStoreFromManager();
    } else {
      this._syncStoreFromManager();
    }
  };

  get debugPrefix() {
    const name = this.options.__debugName || `Facet:${this.options.column}`;
    return `[MosaicFacetMenu] ${name}`;
  }

  public __onConnect() {
    if (this.options.enabled !== false) {
      this.requestUpdate();
    }

    if (this.options.additionalContext) {
      this.options.additionalContext.addEventListener(
        'value',
        this._additionalContextListener,
      );
    }

    this.options.selection.addEventListener('value', this._selectionListener);
  }

  public __onDisconnect() {
    if (this.options.additionalContext) {
      this.options.additionalContext.removeEventListener(
        'value',
        this._additionalContextListener,
      );
    }
    this.options.selection.removeEventListener(
      'value',
      this._selectionListener,
    );
  }

  setSearchTerm(term: string) {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    const delay = this.options.debounceTime ?? 300;

    this._debounceTimer = setTimeout(() => {
      if (this._searchTerm !== term) {
        this._searchTerm = term;
        // Reset limit when search changes to ensure we get relevant top results
        this._currentLimit = this.options.limit || 50;
        this.store.setState((s) => ({ ...s, searchTerm: term }));
        this.requestUpdate();
      }
    }, delay);
  }

  toggle(value: FacetValue) {
    this.selectionManager.toggle(value);
    this._syncStoreFromManager();
  }

  clear() {
    this.selectionManager.select(null);
    this._syncStoreFromManager();
  }

  /**
   * Increases the fetch limit and requests an update.
   */
  loadMore() {
    if (this.store.state.loading || !this.store.state.hasMore) {
      return;
    }

    const increment = 50;
    this._currentLimit += increment;
    logger.debug(
      'Core',
      `${this.debugPrefix} Loading more. New limit: ${this._currentLimit}`,
    );
    this.requestUpdate();
  }

  private _syncStoreFromManager() {
    const values = this.selectionManager.getCurrentValues();
    const currentOptions = this.store.state.options;
    const merged = this._mergeDisplayOptions(currentOptions, values);

    this.store.setState((s) => ({
      ...s,
      selectedValues: values,
      displayOptions: merged,
    }));
  }

  private _mergeDisplayOptions(
    dbOptions: Array<FacetValue>,
    selected: Array<FacetValue>,
  ): Array<FacetValue> {
    const dbSet = new Set(dbOptions);
    const missing = selected.filter((val) => !dbSet.has(val));
    return [...missing, ...dbOptions];
  }

  // --- QUERY LOGIC ---

  override requestQuery(query?: any): Promise<any> | null {
    if (this.options.enabled === false) {
      return Promise.resolve();
    }

    if (!this.coordinator) {
      return Promise.resolve();
    }

    const queryToRun = query || this.query();

    if (!queryToRun) {
      return Promise.resolve();
    }

    return super.requestQuery(queryToRun);
  }

  private resolveSource(
    effectiveFilter?: FilterExpr | null,
  ): string | SelectQuery | null {
    const { table } = this.options;

    if (typeof table === 'function') {
      return table(effectiveFilter);
    }
    if (isParam(table)) {
      return table.value as string;
    }
    return table as string;
  }

  override query(filter?: FilterExpr): SelectQuery | null {
    const {
      column,
      sortMode = 'count',
      columnType,
      isArrayColumn,
      additionalContext,
      filterBy,
      enabled,
      table,
    } = this.options;

    const isTableInvalid = typeof table === 'string' && table.trim() === '';

    if (enabled === false || isTableInvalid) {
      const dummySource =
        this.resolveSource(null) || mSql.sql`(SELECT 1) AS _dummy`;
      return mSql.Query.from(dummySource)
        .select('*')
        .where(mSql.sql`1=0`);
    }

    let effectiveFilter = filter;
    if (filterBy) {
      effectiveFilter = filterBy.predicate(this);
    }

    if (additionalContext) {
      const extraFilter = additionalContext.predicate(this);
      if (extraFilter) {
        effectiveFilter = effectiveFilter
          ? mSql.and(effectiveFilter, extraFilter)
          : extraFilter;
      }
    }

    const resolvedSource = this.resolveSource(effectiveFilter);
    if (!resolvedSource) {
      return mSql.Query.from(mSql.sql`(SELECT 1) AS _dummy`).where(
        mSql.sql`1=0`,
      );
    }

    const isArray = columnType === 'array' || isArrayColumn === true;
    const colExpr = createStructAccess(SqlIdentifier.from(column));

    let query: SelectQuery;

    if (isArray) {
      const innerQuery = mSql.Query.from(resolvedSource).select({
        tag: mSql.unnest(colExpr),
      });

      if (effectiveFilter) {
        innerQuery.where(effectiveFilter);
      }

      query = mSql.Query.from(innerQuery).select('tag').distinct();

      if (this._searchTerm) {
        query.where(
          mSql.sql`tag ILIKE ${mSql.literal('%' + this._searchTerm + '%')}`,
        );
      }

      query.groupby('tag');
      query.orderby(mSql.asc('tag'));
    } else {
      const selection = column.includes('.') ? { [column]: colExpr } : column;
      query = mSql.Query.from(resolvedSource).select(selection);

      if (effectiveFilter) {
        query.where(effectiveFilter);
      }

      if (this._searchTerm) {
        query.where(
          mSql.sql`${colExpr} ILIKE ${mSql.literal('%' + this._searchTerm + '%')}`,
        );
      }

      query.groupby(colExpr);

      if (sortMode === 'count') {
        query.orderby(mSql.desc(mSql.count()));
      } else {
        query.orderby(mSql.asc(colExpr));
      }
    }

    // Use dynamic limit for infinite scrolling
    query.limit(this._currentLimit + 1); // Fetch +1 to detect if there are more results

    return query;
  }

  override queryPending() {
    this.store.setState((s) => ({ ...s, loading: true }));
    return this;
  }

  override queryResult(data: any) {
    const { column, columnType, isArrayColumn } = this.options;
    const isArray = columnType === 'array' || isArrayColumn === true;
    const values: Array<FacetValue> = [];
    const key = isArray ? 'tag' : column;

    let hasMore = false;

    if (data && typeof data.toArray === 'function') {
      const rows = data.toArray();

      // Check if we got more rows than the limit
      if (rows.length > this._currentLimit) {
        hasMore = true;
        // Remove the extra probe row
        rows.pop();
      } else {
        hasMore = false;
      }

      for (const row of rows) {
        let val = row[key];
        if (val === undefined && key.includes('.')) {
          val = key.split('.').reduce((obj: any, k: string) => obj?.[k], row);
        }
        if (val !== null && val !== undefined) {
          values.push(val as FacetValue);
        }
      }
    }

    const currentSelected = this.store.state.selectedValues;
    const merged = this._mergeDisplayOptions(values, currentSelected);

    this.store.setState((s) => ({
      ...s,
      options: values,
      displayOptions: merged,
      loading: false,
      hasMore,
    }));
    return this;
  }

  override queryError(error: Error) {
    if (error.message.includes('syntax error at or near "null"')) {
      this.store.setState((s) => ({ ...s, loading: false }));
      return this;
    }

    handleQueryError(`MosaicFacetMenu #${this.id}`, error);
    this.store.setState((s) => ({ ...s, loading: false }));
    return this;
  }
}
