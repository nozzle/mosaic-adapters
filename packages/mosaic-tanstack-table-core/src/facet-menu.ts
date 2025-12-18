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
}

export interface MosaicFacetMenuState {
  options: Array<FacetValue>;
  loading: boolean;
  searchTerm: string;
  // We mirror the selected values in the store for reactive UI updates
  selectedValues: Array<FacetValue>;
}

let instanceCounter = 0;

/**
 * A "Sidecar" Client for fetching metadata (unique values) independent of the main table query.
 *
 * Why is this needed?
 * 1. The main table query typically applies LIMIT/OFFSET for pagination. A dropdown menu needs
 *    ALL unique values (or the top N by count) across the entire dataset, not just the current page.
 * 2. Cascading Filters: This client allows us to apply a slightly different set of filters
 *    than the main table. Specifically, for a column "A" dropdown, we want to filter by
 *    Columns B and C, but *exclude* the filter on Column A itself (so the user can see
 *    other options to switch to).
 */
export class MosaicFacetMenu extends MosaicClient {
  public options: MosaicFacetMenuOptions;
  readonly store: Store<MosaicFacetMenuState>;
  readonly id: number;

  private selectionManager: MosaicSelectionManager;
  private _searchTerm = '';

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
   * Updates options and handles re-connection/listener updates if needed.
   * This allows the React hook to keep a stable client instance.
   */
  updateOptions(newOptions: MosaicFacetMenuOptions) {
    const oldOptions = this.options;
    this.options = newOptions;

    // Handle additionalContext listeners
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
      // Trigger update because context changed
      this.requestUpdate();
    }

    // If table/column changed, we definitely need an update
    if (
      oldOptions.table !== newOptions.table ||
      oldOptions.column !== newOptions.column
    ) {
      // Update Manager configuration if column/selection changes
      this.selectionManager = new MosaicSelectionManager({
        selection: newOptions.selection,
        client: this,
        column: newOptions.column,
        isArrayColumn: newOptions.isArrayColumn,
      });

      // Clear selection on the new manager (typically swapping columns means reset)
      this.selectionManager.select(null);
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
      logger.debug(
        'Core',
        `${this.debugPrefix} connect() called but coordinator is missing. Repairing...`,
      );
      this.coordinator = this.options.coordinator || defaultCoordinator();
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.coordinator) {
      logger.debug('Core', `${this.debugPrefix} (#${this.id}) Connecting...`);
      this.coordinator.connect(this);
      this.requestUpdate();
    } else {
      logger.error(
        'Core',
        `${this.debugPrefix} connect() failed: Coordinator could not be resolved.`,
      );
    }

    if (this.options.additionalContext) {
      this.options.additionalContext.addEventListener(
        'value',
        this._additionalContextListener,
      );
    }

    return () => {
      logger.debug('Core', `${this.debugPrefix} (#${this.id}) Disconnecting`);
      this.coordinator?.disconnect(this);

      if (this.options.additionalContext) {
        this.options.additionalContext.removeEventListener(
          'value',
          this._additionalContextListener,
        );
      }
    };
  }

  setSearchTerm(term: string) {
    if (this._searchTerm !== term) {
      this._searchTerm = term;
      this.store.setState((s) => ({ ...s, searchTerm: term }));
      this.requestUpdate();
    }
  }

  /**
   * Toggles the selection of a value.
   * If value is null, it clears the selection (Select All / None).
   * Replicates TanStack's `row.toggleSelected()` logic.
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
   * Helper to keep the reactive store in sync with the Manager's state
   */
  private _syncStoreFromManager() {
    const values = this.selectionManager.getCurrentValues();
    this.store.setState((s) => ({ ...s, selectedValues: values }));
  }

  // --- LIFECYCLE DIAGNOSTICS ---

  override requestUpdate(): void {
    logger.debug('Core', `${this.debugPrefix} requestUpdate called`);
    super.requestUpdate();
  }

  override requestQuery(query?: any): Promise<any> | null {
    logger.debug('Core', `${this.debugPrefix} requestQuery called`);

    if (!this.coordinator) {
      logger.warn(
        'Core',
        `${this.debugPrefix} aborted requestQuery: No Coordinator`,
      );
      return Promise.resolve();
    }
    return super.requestQuery(query);
  }

  fieldInfo(info: Array<any>): this {
    logger.debug('Core', `${this.debugPrefix} received fieldInfo`, info);
    return this;
  }

  fields(): Array<any> {
    return [];
  }

  // --- QUERY LOGIC ---

  override query(filter?: FilterExpr): SelectQuery {
    const {
      table,
      column,
      limit = 50,
      sortMode = 'count',
      isArrayColumn,
      additionalContext,
    } = this.options;

    const colExpr = createStructAccess(column);

    // 1. Resolve Primary Filter (Automatic via filterBy -> arguments)
    let effectiveFilter = filter;

    // 2. Resolve Additional Context (Manual)
    if (additionalContext) {
      // We pass 'this' to ensure we don't accidentally include ourselves if the context is also a crossfilter
      const extraFilter = additionalContext.predicate(this);
      if (extraFilter) {
        // Combine Primary + Additional
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
      // Explicitly alias to ensure flat result keys
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

      logger.debug(
        'Mosaic',
        `${this.debugPrefix} received ${rows.length} rows`,
      );

      for (const row of rows) {
        let val = row[key];
        if (val === undefined && key.includes('.')) {
          val = key.split('.').reduce((obj: any, k: string) => obj?.[k], row);
        }

        if (val !== null && val !== undefined) {
          values.push(val as FacetValue);
        }
      }
    } else {
      logger.warn('Core', `${this.debugPrefix} received invalid data`, data);
    }

    this.store.setState((s) => ({
      ...s,
      options: values,
      loading: false,
    }));
    return this;
  }

  override queryError(error: Error) {
    logger.error('Core', `${this.debugPrefix} Query Error`, {
      error,
    });
    this.store.setState((s) => ({ ...s, loading: false }));
    return this;
  }
}
