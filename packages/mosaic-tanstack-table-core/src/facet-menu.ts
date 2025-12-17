// packages/mosaic-tanstack-table-core/src/facet-menu.ts

import {
  MosaicClient,
  coordinator as defaultCoordinator,
} from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { Store } from '@tanstack/store';
import { createStructAccess } from './utils';
import { logger } from './logger';
import type { Coordinator, Selection } from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';

export interface MosaicFacetMenuOptions {
  table: string;
  column: string;
  selection: Selection;
  filterBy?: Selection;
  coordinator?: Coordinator;
  sortMode?: 'alpha' | 'count';
  limit?: number;
  debugName?: string;
  isArrayColumn?: boolean;
}

export interface MosaicFacetMenuState {
  options: Array<any>;
  loading: boolean;
  searchTerm: string;
}

export class MosaicFacetMenu extends MosaicClient {
  readonly options: MosaicFacetMenuOptions;
  readonly store: Store<MosaicFacetMenuState>;

  private _searchTerm = '';

  constructor(options: MosaicFacetMenuOptions) {
    super(options.filterBy);
    this.options = options;

    this.coordinator = options.coordinator || defaultCoordinator();

    if (!(this.coordinator as Coordinator | undefined)) {
      logger.error(
        'Core',
        `[MosaicFacetMenu] No coordinator available for ${this.debugName}. Queries will fail.`,
      );
    }

    this.store = new Store<MosaicFacetMenuState>({
      options: [],
      loading: false,
      searchTerm: '',
    });
  }

  get debugName() {
    return this.options.debugName || `Facet:${this.options.column}`;
  }

  connect(): () => void {
    // REPAIR LOGIC: If coordinator was lost (e.g. via base disconnect), restore it.
    if (!this.coordinator) {
      logger.warn('Core', `[MosaicFacetMenu] ${this.debugName} connect() called but coordinator is missing. Repairing...`);
      this.coordinator = this.options.coordinator || defaultCoordinator();
    }

    if (this.coordinator) {
      logger.debug('Core', `[MosaicFacetMenu] ${this.debugName} Connecting...`);
      this.coordinator.connect(this);
      
      logger.debug('Core', `[MosaicFacetMenu] ${this.debugName} triggering initial requestUpdate`);
      this.requestUpdate();
    } else {
      logger.error('Core', `[MosaicFacetMenu] ${this.debugName} connect() failed: Coordinator could not be resolved.`);
    }

    return () => {
      logger.debug('Core', `[MosaicFacetMenu] ${this.debugName} Disconnecting`);
      this.coordinator?.disconnect(this);
    };
  }

  setSearchTerm(term: string) {
    if (this._searchTerm !== term) {
      this._searchTerm = term;
      this.store.setState((s) => ({ ...s, searchTerm: term }));
      this.requestUpdate();
    }
  }

  select(value: string | null) {
    const { selection, column, isArrayColumn } = this.options;
    const colExpr = createStructAccess(column);
    let predicate: FilterExpr | null = null;

    if (value !== null) {
      if (isArrayColumn) {
        predicate = mSql.listContains(colExpr, mSql.literal(value));
      } else {
        predicate = mSql.eq(colExpr, mSql.literal(value));
      }
    }

    selection.update({
      source: this,
      value: value,
      predicate: predicate,
    });
  }

  // --- LIFECYCLE DIAGNOSTICS ---

  override requestUpdate(): void {
    logger.debug('Core', `[MosaicFacetMenu] ${this.debugName} requestUpdate called`);
    super.requestUpdate();
  }

  override requestQuery(query?: any): Promise<any> | null {
    logger.debug('Core', `[MosaicFacetMenu] ${this.debugName} requestQuery called`);
    
    if (!this.coordinator) {
      logger.warn('Core', `[MosaicFacetMenu] ${this.debugName} aborted requestQuery: No Coordinator`);
      return Promise.resolve();
    }
    return super.requestQuery(query);
  }

  fieldInfo(info: any[]): this {
    logger.debug('Core', `[MosaicFacetMenu] ${this.debugName} received fieldInfo`, info);
    return this;
  }

  fields(): any[] {
    return [];
  }

  // --- QUERY LOGIC ---

  override query(filter?: FilterExpr): SelectQuery {
    logger.debug('SQL', `[MosaicFacetMenu] ${this.debugName} generating query...`);

    const {
      table,
      column,
      limit = 50,
      sortMode = 'count',
      isArrayColumn,
    } = this.options;
    const colExpr = createStructAccess(column);

    let query: SelectQuery;

    if (isArrayColumn) {
      const innerQuery = mSql.Query.from(table).select({
        tag: mSql.unnest(colExpr),
      });

      if (filter) innerQuery.where(filter);

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
      const selection = column.includes('.') 
        ? { [column]: colExpr } 
        : column;

      query = mSql.Query.from(table).select(selection);

      if (filter) query.where(filter);

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

    logger.debug('SQL', `[MosaicFacetMenu] ${this.debugName} generated: ${query.toString()}`);
    return query;
  }

  override queryPending() {
    this.store.setState((s) => ({ ...s, loading: true }));
    return this;
  }

  override queryResult(data: any) {
    const { column, isArrayColumn } = this.options;
    const values: Array<any> = [];
    const key = isArrayColumn ? 'tag' : column;

    if (data && typeof data.toArray === 'function') {
      const rows = data.toArray();
      
      logger.info('Mosaic', `[MosaicFacetMenu] ${this.debugName} received ${rows.length} rows`);

      for (const row of rows) {
        let val = row[key];
        if (val === undefined && key.includes('.')) {
           val = key.split('.').reduce((obj: any, k: string) => obj?.[k], row);
        }

        if (val !== null && val !== undefined) {
          values.push(val);
        }
      }
    } else {
      logger.warn('Core', `[MosaicFacetMenu] ${this.debugName} received invalid data`, data);
    }

    this.store.setState((s) => ({
      ...s,
      options: values,
      loading: false,
    }));
    return this;
  }

  override queryError(error: Error) {
    logger.error(
      'Core',
      `[MosaicFacetMenu] Query Error: ${this.debugName}`,
      { error },
    );
    this.store.setState((s) => ({ ...s, loading: false }));
    return this;
  }
}