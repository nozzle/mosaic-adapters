/**
 * A centralized client for fetching column facet metadata (unique values, min/max ranges).
 * Replaces individual SidecarClients with a single optimized query strategy using CTEs
 * and DuckDB's native structural types (LIST, STRUCT).
 */

import {
  MosaicClient,
  coordinator as defaultCoordinator,
  isArrowTable,
  isParam,
} from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess } from './utils';
import { createLifecycleManager, handleQueryError } from './client-utils';
import { logger } from './logger';
import type { Coordinator, Selection } from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { IMosaicClient, MosaicTableSource } from './types';

export type FacetRequest =
  | {
      type: 'unique';
      column: string;
      sqlColumn: string;
      limit?: number;
      sortMode?: 'alpha' | 'count';
    }
  | { type: 'minmax'; column: string; sqlColumn: string }
  | { type: 'totalCount'; column: string };

export interface MosaicFacetClientOptions {
  filterBy?: Selection;
  table: MosaicTableSource;
  onUpdate: (results: Record<string, any>) => void;
  __debugName?: string;
  coordinator?: Coordinator;
}

export class MosaicFacetClient extends MosaicClient implements IMosaicClient {
  private requests = new Map<string, FacetRequest>();
  private onUpdate: (results: Record<string, any>) => void;
  private table: MosaicTableSource;
  private lifecycle = createLifecycleManager(this);
  private options: MosaicFacetClientOptions;

  // Stores internal table filters: ColumnID -> Predicate
  private internalFilters = new Map<string, FilterExpr>();

  constructor(options: MosaicFacetClientOptions) {
    super(options.filterBy);
    this.options = options;
    this.table = options.table;
    this.onUpdate = options.onUpdate;
    this.coordinator = options.coordinator || defaultCoordinator();
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
   * Registers a column for consolidated fetching.
   * Call this during table initialization for every column with facet meta.
   */
  register(columnId: string, req: FacetRequest) {
    if (!this.requests.has(columnId)) {
      this.requests.set(columnId, req);
    }
  }

  /**
   * Updates the data source (e.g. when table prop changes).
   */
  updateSource(source: MosaicTableSource) {
    if (this.table !== source) {
      this.table = source;
      this.requestUpdate();
    }
  }

  /**
   * Updates the internal filter state.
   * Used to implement cascading facets (Table Client pushes its internal state here).
   */
  setInternalFilters(filters: Map<string, FilterExpr>) {
    this.internalFilters = filters;
    this.requestUpdate();
  }

  /**
   * The Consolidated Query Generator.
   * Uses CTEs to apply filters once, then aggregates all requested facets.
   */
  override query(filter: FilterExpr): SelectQuery | null {
    if (this.requests.size === 0) {
      return null;
    }

    const source = this.resolveSource(filter);
    // Explicit check against empty string to prevent invalid SQL
    if (!source || (typeof source === 'string' && source.trim() === '')) {
      return null;
    }

    // 1. Create the Base CTE (The Viewport)
    // This applies ONLY the Global Filters (passed via resolveSource/filter arg).
    // Internal table filters are applied selectively in the subqueries.
    let baseQuery: SelectQuery;

    if (typeof source === 'string') {
      // Must explicitly select * to be a valid CTE source if it's just a table name
      baseQuery = mSql.Query.from(source).select('*');
      if (filter) {
        baseQuery.where(filter);
      }
    } else {
      // It is already a Query object. Use it directly as the CTE definition.
      baseQuery = source;
    }

    // 2. Build Subqueries for each Facet
    const selectionMap: Record<string, any> = {};

    for (const [colId, req] of this.requests.entries()) {
      let subQuery: SelectQuery;

      // CASCADING LOGIC:
      // Construct a WHERE clause that includes all internal filters EXCEPT the one for this column.
      // This ensures the dropdown shows "What values are available given ALL OTHER selections".
      const cascadingClauses: Array<FilterExpr> = [];
      for (const [filterColId, predicate] of this.internalFilters.entries()) {
        if (filterColId !== colId) {
          cascadingClauses.push(predicate);
        }
      }

      const hasCascadingFilters = cascadingClauses.length > 0;

      if (req.type === 'totalCount') {
        subQuery = mSql.Query.from('viewport').select({
          count: mSql.count(),
        });
        // Total Count respects ALL internal filters (no exclusion)
        // Re-add the excluded filter if it exists
        if (this.internalFilters.has(colId)) {
          cascadingClauses.push(this.internalFilters.get(colId)!);
        }
        if (cascadingClauses.length > 0) {
          subQuery.where(mSql.and(...cascadingClauses));
        }
      } else if (req.type === 'unique') {
        // Generates: (SELECT list(val) FROM (SELECT col AS val, count(*) FROM viewport WHERE ... GROUP BY col ORDER BY count(*) DESC LIMIT 50) )
        const colExpr = createStructAccess(req.sqlColumn);
        const distinctSub = mSql.Query.from('viewport')
          .select({ val: colExpr })
          .groupby(colExpr)
          .limit(req.limit || 50);

        if (hasCascadingFilters) {
          distinctSub.where(mSql.and(...cascadingClauses));
        }

        if (req.sortMode === 'alpha') {
          distinctSub.orderby(mSql.asc(colExpr));
        } else {
          // Default to count desc
          distinctSub.orderby(mSql.desc(mSql.count()));
        }

        subQuery = mSql.Query.from(distinctSub).select({
          list: mSql.sql`list(${mSql.column('val')})`,
        });
      } else {
        // req.type is 'minmax'
        // Generates: (SELECT {'min': MIN(col), 'max': MAX(col)} FROM viewport WHERE ...)
        const colExpr = createStructAccess(req.sqlColumn);
        subQuery = mSql.Query.from('viewport').select({
          stats: mSql.sql`{'min': MIN(${colExpr}), 'max': MAX(${colExpr})}`,
        });

        if (hasCascadingFilters) {
          subQuery.where(mSql.and(...cascadingClauses));
        }
      }

      // Explicitly wrap the subquery in parentheses to ensure it's treated as a scalar subquery expression
      selectionMap[colId] = mSql.sql`(${subQuery})`;
    }

    // If selectionMap is empty (shouldn't happen given size check, but safe guard)
    if (Object.keys(selectionMap).length === 0) {
      return null;
    }

    // 3. Assemble Final Query
    // We use a pattern that doesn't select FROM the viewport in the outer query
    // This reduces ambiguity and relies on the subqueries accessing the CTE.
    const query = mSql.Query.with({ viewport: baseQuery }).select(selectionMap);

    logger.debug(
      'SQL',
      `[MosaicFacetClient] Consolidated Facet Query:\n${query.toString()}`,
    );

    return query;
  }

  override queryResult(arrowTable: any) {
    if (!isArrowTable(arrowTable) || arrowTable.numRows === 0) {
      return this;
    }

    const row = arrowTable.get(0); // Arrow table proxy object
    const results: Record<string, any> = {};

    for (const [colId, req] of this.requests.entries()) {
      const val = row[colId];

      if (val !== undefined && val !== null) {
        // Convert Arrow structures (List, Struct) to JS native types
        const jsonVal = val?.toJSON ? val.toJSON() : val;

        if (req.type === 'totalCount') {
          // Robust check for Total Count format
          results[colId] =
            typeof jsonVal === 'object' &&
            jsonVal !== null &&
            'count' in jsonVal
              ? jsonVal.count
              : jsonVal;
        } else {
          // unique (List) or minmax (Struct)
          results[colId] = jsonVal;
        }
      }
    }

    this.onUpdate(results);
    return this;
  }

  override queryError(error: Error): this {
    handleQueryError(this.options.__debugName || 'MosaicFacetClient', error);
    return this;
  }

  private resolveSource(filter: FilterExpr): string | SelectQuery {
    if (typeof this.table === 'function') {
      return this.table(filter);
    }
    if (isParam(this.table)) {
      return this.table.value as string;
    }
    return this.table as string;
  }
}
