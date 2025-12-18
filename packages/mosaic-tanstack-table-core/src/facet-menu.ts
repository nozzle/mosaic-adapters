// packages/mosaic-tanstack-table-core/src/facet-menu.ts

import {
  MosaicClient,
  coordinator as defaultCoordinator,
} from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { Store } from '@tanstack/store';
import { createStructAccess } from './utils';
import { logger } from './logger';
import { MosaicSelectionManager } from './selection-manager';
import type { Coordinator, Selection } from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';

export type FacetValue = string | number | boolean | Date | null;

export interface MosaicFacetMenuOptions {
  table: string;
  column: string;
  selection: Selection;
  filterBy?: Selection;
  additionalContext?: Selection;
  coordinator?: Coordinator;
  sortMode?: 'alpha' | 'count';
  limit?: number;
  debugName?: string;
  isArrayColumn?: boolean;
  /**
   * Debounce time in milliseconds for search term updates.
   * @default 300
   */
  debounceTime?: number;
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
}

let instanceCounter = 0;

/**
 * A "Sidecar" Client for fetching metadata (unique values) independent of the main table query.
 *
 * Features:
 * - Fetches unique values from the database (Facet)
 * - Manages selection state (Multi-select / Single-select support via Manager)
 * - Handles cascading logic (excludes own column filters)
 * - Merges selected values into display options (UX best practice)
 * - Internal debouncing for search inputs
 */
export class MosaicFacetMenu extends MosaicClient {
  public options: MosaicFacetMenuOptions;
  readonly store: Store<MosaicFacetMenuState>;
  readonly id: number;

  private selectionManager: MosaicSelectionManager;
  private _searchTerm = '';
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: MosaicFacetMenuOptions) {
    super(options.filterBy);
    this.options = options;
    this.id = ++instanceCounter;

    this.coordinator = options.coordinator || defaultCoordinator();

    if (!(this.coordinator as Coordinator | undefined)) {
      logger.error(
        'Core',
        `${this.debugPrefix} No coordinator available. Queries will fail.`,
      );
    }

    this.store = new Store<MosaicFacetMenuState>({
      options: [],
      displayOptions: [],
      loading: false,
      searchTerm: '',
      selectedValues: [],
    });

    // Initialize Manager
    this.selectionManager = new MosaicSelectionManager({
      selection: options.selection,
      client: this,
      column: options.column,
      isArrayColumn: options.isArrayColumn,
    });

    logger.debug('Core', `${this.debugPrefix} Created Instance #${this.id}`);
  }

  /**
   * Override the base filterBy getter to ensure the Coordinator always sees
   * the most current selection from options.
   */
  override get filterBy() {
    return this.options.filterBy;
  }

  /**
   * Updates options and handles re-connection/listener updates if needed.
   */
  updateOptions(newOptions: MosaicFacetMenuOptions) {
    const oldOptions = this.options;
    this.options = newOptions;

    // 1. Handle Primary Filter (filterBy) changes
    if (oldOptions.filterBy !== newOptions.filterBy) {
      logger.debug(
        'Core',
        `${this.debugPrefix} filterBy changed. Reconnecting to Coordinator.`,
      );
      if (this.coordinator) {
        this.coordinator.disconnect(this);
        this.coordinator.connect(this);
      }
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

    // 3. Handle Structural Changes
    if (
      oldOptions.table !== newOptions.table ||
      oldOptions.column !== newOptions.column ||
      oldOptions.selection !== newOptions.selection
    ) {
      this.selectionManager = new MosaicSelectionManager({
        selection: newOptions.selection,
        client: this,
        column: newOptions.column,
        isArrayColumn: newOptions.isArrayColumn,
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
    logger.debug(
      'Core',
      `${this.debugPrefix} (#${this.id}) additionalContext updated`,
    );
    this.requestUpdate();
  };

  get debugPrefix() {
    const name = this.options.debugName || `Facet:${this.options.column}`;
    return `[MosaicFacetMenu] ${name}`;
  }

  connect(): () => void {
    if (!this.coordinator) {
      this.coordinator = this.options.coordinator || defaultCoordinator();
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.coordinator) {
      this.coordinator.connect(this);
      this.requestUpdate();
    }

    if (this.options.additionalContext) {
      this.options.additionalContext.addEventListener(
        'value',
        this._additionalContextListener,
      );
    }

    return () => {
      this.coordinator?.disconnect(this);
      if (this.options.additionalContext) {
        this.options.additionalContext.removeEventListener(
          'value',
          this._additionalContextListener,
        );
      }
    };
  }

  /**
   * Sets the search term with built-in debouncing.
   * @param term The new search string
   */
  setSearchTerm(term: string) {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    // Update the store immediately if needed for UI mirroring?
    // Usually React inputs track their own state, so we only update the store when the query actually runs.
    // However, fast typists might want to know if the search is "pending".
    // For now, we wait for debounce to fire.

    const delay = this.options.debounceTime ?? 300;

    this._debounceTimer = setTimeout(() => {
      if (this._searchTerm !== term) {
        this._searchTerm = term;
        this.store.setState((s) => ({ ...s, searchTerm: term }));
        this.requestUpdate();
      }
    }, delay);
  }

  /**
   * Toggles the selection of a value.
   */
  toggle(value: FacetValue) {
    this.selectionManager.toggle(value);
    this._syncStoreFromManager();
  }

  /**
   * Clears the current selection (Select All/None).
   */
  clear() {
    this.selectionManager.select(null);
    this._syncStoreFromManager();
  }

  /**
   * Helper to keep the reactive store in sync with the Manager's state.
   * Also re-calculates displayOptions to ensure selected items are visible.
   */
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

  /**
   * Merges database options with selected values.
   * Logic: Prepend any selected values that are NOT present in the database response.
   * This handles cases where filters/limits hide the currently selected item.
   */
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
    if (!this.coordinator) {
      return Promise.resolve();
    }
    return super.requestQuery(query);
  }

  override query(filter?: FilterExpr): SelectQuery {
    const {
      table,
      column,
      limit = 50,
      sortMode = 'count',
      isArrayColumn,
      additionalContext,
      filterBy,
    } = this.options;

    const colExpr = createStructAccess(column);

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

    let query: SelectQuery;

    if (isArrayColumn) {
      const innerQuery = mSql.Query.from(table).select({
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
      query = mSql.Query.from(table).select(selection);

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

    query.limit(limit);

    logger.debounce(
      `facet-query-${this.id}`,
      300,
      'debug',
      'SQL',
      `Facet Query (${this.options.debugName})`,
      {
        sql: query.toString(),
        filters: effectiveFilter ? effectiveFilter.toString() : 'None',
      },
    );

    return query;
  }

  override queryPending() {
    this.store.setState((s) => ({ ...s, loading: true }));
    return this;
  }

  override queryResult(data: any) {
    const { column, isArrayColumn } = this.options;
    const values: Array<FacetValue> = [];
    const key = isArrayColumn ? 'tag' : column;

    if (data && typeof data.toArray === 'function') {
      const rows = data.toArray();
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

    // Update state with new options AND re-calculate displayOptions
    const currentSelected = this.store.state.selectedValues;
    const merged = this._mergeDisplayOptions(values, currentSelected);

    this.store.setState((s) => ({
      ...s,
      options: values,
      displayOptions: merged,
      loading: false,
    }));
    return this;
  }

  override queryError(error: Error) {
    logger.error('Core', `${this.debugPrefix} Query Error`, { error });
    this.store.setState((s) => ({ ...s, loading: false }));
    return this;
  }
}
