import * as mSql from '@uwdata/mosaic-sql';
import { isParam } from '@uwdata/mosaic-core';
import { createStructAccess } from './utils';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { MosaicTableSource } from './types';

export interface FacetQueryContext {
  source: MosaicTableSource; // The table or subquery
  column: string;
  /** Internal table filters (excluding the facet column itself) */
  cascadingFilters: Array<FilterExpr>;
  /** Global/Primary filter (from filterBy) */
  primaryFilter?: FilterExpr | null;
  searchTerm?: string; // For unique values
  limit?: number;
  sortMode?: 'alpha' | 'count';
}

export interface FacetStrategy<TResult> {
  buildQuery: (ctx: FacetQueryContext) => SelectQuery;
  transformResult: (rows: Array<any>, column: string) => TResult;
}

/**
 * Strategy for fetching unique values from a column.
 * Used for Dropdown/Select filters.
 */
export const UniqueValuesStrategy: FacetStrategy<Array<unknown>> = {
  buildQuery: (ctx) => {
    let src: string | SelectQuery;
    // Filters to apply to the OUTER query
    const outerFilters: Array<FilterExpr> = [];

    if (typeof ctx.source === 'function') {
      // 1. Source is a Factory: Pass Primary Filter INNER
      // This ensures filters on raw columns (e.g. 'dx' in NYC Taxi) are applied
      // before aggregation/projection hides them.
      src = ctx.source(ctx.primaryFilter);

      // Cascading filters (on table columns) go OUTER
      // These usually reference columns present in the table view (e.g. 'trip_count')
      if (ctx.cascadingFilters.length > 0) {
        outerFilters.push(...ctx.cascadingFilters);
      }
    } else {
      // 2. Source is Table Name/Param: Everything goes OUTER
      src = isParam(ctx.source)
        ? (ctx.source.value as string)
        : (ctx.source as string);

      if (ctx.primaryFilter) {
        outerFilters.push(ctx.primaryFilter);
      }
      if (ctx.cascadingFilters.length > 0) {
        outerFilters.push(...ctx.cascadingFilters);
      }
    }

    const statement = mSql.Query.from(src).select(ctx.column);

    // Apply accumulated outer filters
    if (outerFilters.length > 0) {
      statement.where(mSql.and(...outerFilters));
    }

    // Add search term filter if present
    if (ctx.searchTerm) {
      const colExpr = createStructAccess(ctx.column);
      const pattern = mSql.literal(`%${ctx.searchTerm}%`);
      statement.where(mSql.sql`${colExpr} ILIKE ${pattern}`);
    }

    statement.groupby(ctx.column);

    // Sort Logic
    if (ctx.sortMode === 'count') {
      statement.orderby(mSql.desc(mSql.count()));
    } else {
      statement.orderby(mSql.asc(mSql.column(ctx.column)));
    }

    // Limit Logic
    if (ctx.limit !== undefined) {
      statement.limit(ctx.limit);
    }

    return statement;
  },

  transformResult: (rows, col) => {
    const values: Array<unknown> = [];
    rows.forEach((row) => {
      let val = row[col];
      // Handle struct access in result if needed
      if (val === undefined && col.includes('.')) {
        val = col.split('.').reduce((obj: any, k: string) => obj?.[k], row);
      }
      values.push(val);
    });
    return values;
  },
};

/**
 * Strategy for fetching Min/Max values from a column.
 * Used for Range Sliders.
 */
export const MinMaxStrategy: FacetStrategy<[number, number] | undefined> = {
  buildQuery: (ctx) => {
    let src: string | SelectQuery;
    const outerFilters: Array<FilterExpr> = [];

    if (typeof ctx.source === 'function') {
      // Factory: Primary Filter INNER
      src = ctx.source(ctx.primaryFilter);
      // Cascading Filters OUTER
      if (ctx.cascadingFilters.length > 0) {
        outerFilters.push(...ctx.cascadingFilters);
      }
    } else {
      // String: All OUTER
      src = isParam(ctx.source)
        ? (ctx.source.value as string)
        : (ctx.source as string);

      if (ctx.primaryFilter) {
        outerFilters.push(ctx.primaryFilter);
      }
      if (ctx.cascadingFilters.length > 0) {
        outerFilters.push(...ctx.cascadingFilters);
      }
    }

    const col = mSql.column(ctx.column);
    const statement = mSql.Query.from(src).select({
      min: mSql.min(col),
      max: mSql.max(col),
    });

    if (outerFilters.length > 0) {
      statement.where(mSql.and(...outerFilters));
    }

    return statement;
  },

  transformResult: (rows) => {
    if (rows.length > 0) {
      const row = rows[0];
      return [row.min, row.max];
    }
    return undefined;
  },
};
