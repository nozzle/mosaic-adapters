import * as mSql from '@uwdata/mosaic-sql';
import { isParam } from '@uwdata/mosaic-core';
import { createStructAccess } from './utils';
import { SqlIdentifier } from './domain/sql-identifier';
import { assertIsArray, assertIsNumber } from './validation';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { MosaicTableSource } from './types';

export interface FacetQueryContext<TInput = any> {
  /** The table or subquery used as the source for the facet query. */
  source: MosaicTableSource;
  column: string;
  /** Internal table filters (excluding the facet column itself) */
  cascadingFilters: Array<FilterExpr>;
  /** Global/Primary filter (from filterBy) */
  primaryFilter?: FilterExpr | null;
  searchTerm?: string; // For unique values
  limit?: number;
  sortMode?: 'alpha' | 'count';
  /** Custom configuration options passed from the UI */
  options?: TInput;
}

/**
 * Interface for Facet Strategies.
 * Uses manual validation instead of schema libraries to ensure runtime safety.
 */
export interface FacetStrategy<TInput, TOutput> {
  /**
   * Constructs the SQL query to fetch facet data.
   * @param ctx - The context containing source, column, filters, and custom options.
   * @returns A Mosaic SQL SelectQuery object.
   */
  buildQuery: (ctx: FacetQueryContext<TInput>) => SelectQuery;

  /**
   * Transforms the raw database result rows into the expected output shape.
   * @param rows - The raw array of objects returned by the database driver.
   * @param column - The column name used in the query (useful for extracting values).
   * @returns The transformed data matching TOutput.
   */
  transformResult: (rows: Array<any>, column: string) => TOutput;

  /**
   * Validates the transformed result at runtime.
   * Should throw an error if the data does not match TOutput.
   */
  validate: (data: unknown) => TOutput;
}

/**
 * Strategy for fetching unique values from a column.
 * Used for Dropdown/Select filters.
 */
export const UniqueValuesStrategy: FacetStrategy<void, Array<unknown>> = {
  buildQuery: (ctx) => {
    let src: string | SelectQuery;
    const outerFilters: Array<FilterExpr> = [];

    if (typeof ctx.source === 'function') {
      src = ctx.source(ctx.primaryFilter);
      if (ctx.cascadingFilters.length > 0) {
        outerFilters.push(...ctx.cascadingFilters);
      }
    } else {
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

    if (outerFilters.length > 0) {
      statement.where(mSql.and(...outerFilters));
    }

    if (ctx.searchTerm) {
      const colExpr = createStructAccess(SqlIdentifier.from(ctx.column));
      const pattern = mSql.literal(`%${ctx.searchTerm}%`);
      statement.where(mSql.sql`${colExpr} ILIKE ${pattern}`);
    }

    statement.groupby(ctx.column);

    if (ctx.sortMode === 'count') {
      statement.orderby(mSql.desc(mSql.count()));
    } else {
      statement.orderby(mSql.asc(mSql.column(ctx.column)));
    }

    if (ctx.limit !== undefined) {
      statement.limit(ctx.limit);
    }

    return statement;
  },

  transformResult: (rows, col) => {
    const values: Array<unknown> = [];
    rows.forEach((row) => {
      let val = row[col];
      if (val === undefined && col.includes('.')) {
        val = col.split('.').reduce((obj: any, k: string) => obj?.[k], row);
      }
      values.push(val);
    });
    return values;
  },

  validate: (data) => {
    assertIsArray(data);
    return data;
  },
};

/**
 * Strategy for fetching Min/Max values from a column.
 * Used for Range Sliders.
 */
export const MinMaxStrategy: FacetStrategy<void, [number, number] | undefined> =
  {
    buildQuery: (ctx) => {
      let src: string | SelectQuery;
      const outerFilters: Array<FilterExpr> = [];

      if (typeof ctx.source === 'function') {
        src = ctx.source(ctx.primaryFilter);
        if (ctx.cascadingFilters.length > 0) {
          outerFilters.push(...ctx.cascadingFilters);
        }
      } else {
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
        const min = Number(row.min);
        const max = Number(row.max);
        if (!isNaN(min) && !isNaN(max)) {
          return [min, max];
        }
      }
      return undefined;
    },

    validate: (data) => {
      if (data === undefined) {
        return undefined;
      }
      assertIsArray(data);
      if (data.length === 2) {
        assertIsNumber(data[0]);
        assertIsNumber(data[1]);
        return data as [number, number];
      }
      return undefined;
    },
  };

/**
 * Strategy for fetching the Total Row Count.
 * Used for Pagination in 'split' mode.
 */
export const TotalCountStrategy: FacetStrategy<void, number> = {
  buildQuery: (ctx) => {
    let src: string | SelectQuery;
    const outerFilters: Array<FilterExpr> = [];

    if (typeof ctx.source === 'function') {
      src = ctx.source(ctx.primaryFilter);
      if (ctx.cascadingFilters.length > 0) {
        outerFilters.push(...ctx.cascadingFilters);
      }
    } else {
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

    const statement = mSql.Query.from(src).select({
      count: mSql.count(),
    });

    if (outerFilters.length > 0) {
      statement.where(mSql.and(...outerFilters));
    }

    return statement;
  },

  transformResult: (rows) => {
    if (rows.length > 0) {
      return Number(rows[0].count) || 0;
    }
    return 0;
  },

  validate: (data) => {
    assertIsNumber(data);
    return data;
  },
};

export const defaultFacetStrategies: Record<string, FacetStrategy<any, any>> = {
  unique: UniqueValuesStrategy,
  minmax: MinMaxStrategy,
  totalCount: TotalCountStrategy,
};
