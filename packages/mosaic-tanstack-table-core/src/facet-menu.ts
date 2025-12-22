import { coordinator as defaultCoordinator } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { Store } from '@tanstack/store';
import { createStructAccess } from './utils';
import { MosaicSelectionManager } from './selection-manager';
import { BaseMosaicClient } from './base-client';
import type { Coordinator, Selection } from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { ColumnType } from './types';

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
  __debugName?: string;
  columnType?: ColumnType;
  isArrayColumn?: boolean;
  debounceTime?: number;
  enabled?: boolean;
}

export interface MosaicFacetMenuState {
  options: Array<FacetValue>;
  displayOptions: Array<FacetValue>;
  loading: boolean;
  searchTerm: string;
  selectedValues: Array<FacetValue>;
}

let instanceCounter = 0;

/**
 * A Mosaic Client that fetches and manages unique values for a column to power filter menus.
 */
export class MosaicFacetMenu extends BaseMosaicClient {
  public options: MosaicFacetMenuOptions;
  readonly store: Store<MosaicFacetMenuState>;
  readonly id: number;

  private selectionManager: MosaicSelectionManager;
  private _searchTerm = '';
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: MosaicFacetMenuOptions) {
    super(options.filterBy, options.coordinator);
    this.options = options;
    this.id = ++instanceCounter;

    this.store = new Store<MosaicFacetMenuState>({
      options: [],
      displayOptions: [],
      loading: false,
      searchTerm: '',
      selectedValues: [],
    });

    this.selectionManager = new MosaicSelectionManager({
      selection: options.selection,
      client: this,
      column: options.column,
      columnType:
        options.columnType ?? (options.isArrayColumn ? 'array' : 'scalar'),
    });
  }

  override get filterBy() {
    return this.options.filterBy;
  }

  updateOptions(newOptions: MosaicFacetMenuOptions) {
    const oldOptions = this.options;
    this.options = newOptions;

    const nextCoordinator =
      newOptions.coordinator || this.coordinator || defaultCoordinator();
    this.setCoordinator(nextCoordinator);

    if (oldOptions.filterBy !== newOptions.filterBy) {
      this.requestUpdate();
    }

    if (oldOptions.enabled !== newOptions.enabled && newOptions.enabled) {
      this.requestUpdate();
    }

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

    if (
      oldOptions.table !== newOptions.table ||
      oldOptions.column !== newOptions.column ||
      oldOptions.selection !== newOptions.selection ||
      oldOptions.columnType !== newOptions.columnType ||
      oldOptions.isArrayColumn !== newOptions.isArrayColumn
    ) {
      if (oldOptions.selection !== newOptions.selection) {
        oldOptions.selection.removeEventListener(
          'value',
          this._syncStoreFromManager,
        );
        newOptions.selection.addEventListener(
          'value',
          this._syncStoreFromManager,
        );
      }

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

  get debugPrefix() {
    const name = this.options.__debugName || `Facet:${this.options.column}`;
    return `[MosaicFacetMenu] ${name}`;
  }

  protected override onConnect() {
    if (this.options.enabled !== false) {
      this.requestUpdate();
    }

    if (this.options.additionalContext) {
      this.options.additionalContext.addEventListener(
        'value',
        this._additionalContextListener,
      );
    }

    // REACTIVE UI FIX:
    // Listen to the selection object so the store (and thus the checkboxes)
    // updates whenever the filter state changes globally.
    this.options.selection.addEventListener(
      'value',
      this._syncStoreFromManager,
    );
    this._syncStoreFromManager();
  }

  protected override onDisconnect() {
    if (this.options.additionalContext) {
      this.options.additionalContext.removeEventListener(
        'value',
        this._additionalContextListener,
      );
    }
    this.options.selection.removeEventListener(
      'value',
      this._syncStoreFromManager,
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
        this.store.setState((s) => ({ ...s, searchTerm: term }));
        this.requestUpdate();
      }
    }, delay);
  }

  toggle(value: FacetValue) {
    this.selectionManager.toggle(value);
    // SelectionManager triggers the selection 'value' event,
    // which our listener will catch to update the UI store.
  }

  clear() {
    this.selectionManager.select(null);
  }

  private _syncStoreFromManager = () => {
    const values = this.selectionManager.getCurrentValues();
    const currentOptions = this.store.state.options;
    const merged = this._mergeDisplayOptions(currentOptions, values);

    this.store.setState((s) => ({
      ...s,
      selectedValues: values,
      displayOptions: merged,
    }));
  };

  private _mergeDisplayOptions(
    dbOptions: Array<FacetValue>,
    selected: Array<FacetValue>,
  ): Array<FacetValue> {
    const dbSet = new Set(dbOptions);
    const missing = selected.filter((val) => !dbSet.has(val));
    return [...missing, ...dbOptions];
  }

  override query(filter?: FilterExpr): SelectQuery | null {
    if (
      this.options.enabled === false ||
      !this.options.table ||
      (typeof this.options.table === 'string' &&
        this.options.table.trim() === '')
    ) {
      return null;
    }

    const {
      table,
      column,
      limit = 50,
      sortMode = 'count',
      columnType,
      isArrayColumn,
      additionalContext,
      filterBy,
    } = this.options;

    const isArray = columnType === 'array' || isArrayColumn === true;
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

    if (isArray) {
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
    super.queryError(error);
    this.store.setState((s) => ({ ...s, loading: false }));
    return this;
  }
}
