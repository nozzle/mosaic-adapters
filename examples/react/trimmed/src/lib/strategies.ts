import * as mSql from '@uwdata/mosaic-sql';
import { isParam } from '@uwdata/mosaic-core';
// Import validation helpers from the core package
import {
  assertIsArray,
  assertIsNumber,
} from '@nozzleio/mosaic-tanstack-table-core';
import type {
  FacetQueryContext,
  FacetStrategy,
} from '@nozzleio/mosaic-tanstack-react-table';

export interface HistogramBin {
  bin0: number;
  bin1: number;
  count: number;
}

export interface HistogramInput {
  binSize: number;
}

/**
 * A custom strategy to generate Histogram data.
 * Bins a numeric column and counts records per bin.
 */
export const HistogramStrategy: FacetStrategy<
  HistogramInput,
  Array<HistogramBin>
> = {
  buildQuery: (ctx: FacetQueryContext<HistogramInput>) => {
    // Access options safely via ctx.options (strongly typed now)
    const binSize = ctx.options?.binSize || 10;
    const col = mSql.column(ctx.column);

    // SQL: FLOOR(col / binSize) * binSize
    const binExpression = mSql.sql`FLOOR(${col} / ${binSize}) * ${binSize}`;

    let src: any;
    const outerFilters: Array<any> = [];

    // 1. Resolve Source & Filters (Standard Pattern)
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

    // 2. Build Aggregate Query
    const query = mSql.Query.from(src)
      .select({
        bin0: binExpression,
        count: mSql.count(),
      })
      .groupby('bin0')
      .orderby(mSql.asc('bin0'));

    // 3. Apply Filters
    if (outerFilters.length > 0) {
      query.where(mSql.and(...outerFilters));
    }

    // 4. Ensure we don't return null bins (optional, depending on data)
    query.where(mSql.sql`${col} IS NOT NULL`);

    return query;
  },

  transformResult: (rows: Array<any>, _column: string) => {
    // Post-process to add bin1 (end of bin) for convenience
    return rows.map((r) => ({
      bin0: Number(r.bin0),
      bin1: Number(r.bin0) + 5, // We'd ideally pass binSize through context or infer it
      count: Number(r.count),
    }));
  },

  // Required Runtime Validation
  validate: (data: unknown) => {
    assertIsArray(data);
    // Basic shape check for the first item if it exists
    if (data.length > 0) {
      const item = data[0] as any;
      if (typeof item !== 'object' || item === null) {
        throw new Error('Invalid histogram data format');
      }
      assertIsNumber(item.bin0);
      assertIsNumber(item.count);
    }
    return data as Array<HistogramBin>;
  },
};
