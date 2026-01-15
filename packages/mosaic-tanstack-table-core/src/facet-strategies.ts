import * as mSql from '@uwdata/mosaic-sql';
import { isParam } from '@uwdata/mosaic-core';
import { assertIsArray, assertIsNumber } from './validation';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { MosaicTableSource } from './types';

export interface FacetQueryContext<TInput = unknown> {
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
 * Uses strict typing for rows to avoid 'any'.
 */
export interface FacetStrategy<TInput = unknown, TOutput = unknown> {
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
  transformResult: (
    rows: Array<Record<string, unknown>>,
    column: string,
  ) => TOutput;

  /**
   * Validates the transformed result at runtime.
   * Should throw an error if the data does not match TOutput.
   */
  validate: (data: unknown) => TOutput;
}

export interface HistogramInput {
  step: number;
}

export type HistogramOutput = Array<{ bin: number; count: number }>;

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
      // Simple ILIKE match for search
      const pattern = mSql.literal(`%${ctx.searchTerm}%`);
      statement.where(mSql.sql`${mSql.column(ctx.column)} ILIKE ${pattern}`);
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
      // Handle struct access in results (e.g. "struct.field")
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
      const row = rows.length > 0 ? rows[0] : undefined;
      if (row) {
        const minVal = row['min'];
        const maxVal = row['max'];
        const min = Number(minVal);
        const max = Number(maxVal);
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
    const row = rows.length > 0 ? rows[0] : undefined;
    if (row) {
      return Number(row['count']) || 0;
    }
    return 0;
  },

  validate: (data) => {
    assertIsNumber(data);
    return data;
  },
};

/**
 * Strategy for fetching Binned Histogram data.
 * Used for Histogram Bar Charts.
 */
export const HistogramStrategy: FacetStrategy<HistogramInput, HistogramOutput> =
  {
    buildQuery: (ctx) => {
      // Step is required for this strategy
      const { step } = ctx.options!;

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
      const stepLit = mSql.literal(step);

      // DuckDB-friendly binning: floor(col / step) * step
      const binExpr = mSql.sql`FLOOR(${col} / ${stepLit}) * ${stepLit}`;

      const statement = mSql.Query.from(src)
        .select({
          bin: binExpr,
          count: mSql.count(),
        })
        .groupby(mSql.sql`1`) // Group by the first selected column alias (bin)
        .orderby(mSql.asc(mSql.sql`1`));

      if (outerFilters.length > 0) {
        statement.where(mSql.and(...outerFilters));
      }

      return statement;
    },

    transformResult: (rows) => {
      return rows.map((row) => ({
        bin: Number(row['bin']),
        count: Number(row['count']),
      }));
    },

    validate: (data) => {
      if (!Array.isArray(data)) {
        throw new Error('Histogram data must be an array');
      }
      return data as HistogramOutput;
    },
  };

export const defaultFacetStrategies: Record<string, FacetStrategy<any, any>> = {
  unique: UniqueValuesStrategy,
  minmax: MinMaxStrategy,
  totalCount: TotalCountStrategy,
  histogram: HistogramStrategy,
};
