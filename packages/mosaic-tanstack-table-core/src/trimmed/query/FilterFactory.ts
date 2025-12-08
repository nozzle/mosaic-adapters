// Factory for generating Mosaic SQL Filter Expressions.
// Decouples the "How" of filtering (Range vs Exact vs Fuzzy) from the "When" (Table State loop).

import * as mSql from '@uwdata/mosaic-sql';
import { escapeSqlLikePattern, toRangeValue } from '../utils';
import { logger } from '../logger';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { MosaicDataTableSqlFilterType } from '../types';

type FilterStrategy = (
  columnAccessor: string,
  value: unknown,
  columnId?: string,
) => FilterExpr | undefined;

const DEFAULT_SQL_FILTER_TYPE: MosaicDataTableSqlFilterType = 'EQUALS';

const strategies: Record<MosaicDataTableSqlFilterType, FilterStrategy> = {
  RANGE: (columnAccessor, value, columnId) => {
    // Only handle Range Filters (Array values for Min/Max)
    if (!Array.isArray(value)) {
      logger.warn(
        'Core',
        `[FilterFactory] Column "${columnId}" has a non-array value but filterType is "range". Skipping to avoid invalid SQL.`,
      );
      return undefined;
    }

    const [rawMin, rawMax] = value as [unknown, unknown];
    const min = toRangeValue(rawMin);
    const max = toRangeValue(rawMax);

    // Build SQL clauses using Mosaic literals to handle type safety
    if (min !== null && max !== null) {
      return mSql.isBetween(mSql.column(columnAccessor), [
        mSql.literal(min),
        mSql.literal(max),
      ]);
    } else if (min !== null) {
      return mSql.gte(mSql.column(columnAccessor), mSql.literal(min));
    } else if (max !== null) {
      return mSql.lte(mSql.column(columnAccessor), mSql.literal(max));
    }
    return undefined;
  },

  ILIKE: (columnAccessor, value, columnId) => {
    return handleLike(columnAccessor, value, columnId, 'ILIKE', false);
  },
  LIKE: (columnAccessor, value, columnId) => {
    return handleLike(columnAccessor, value, columnId, 'LIKE', false);
  },
  PARTIAL_LIKE: (columnAccessor, value, columnId) => {
    return handleLike(columnAccessor, value, columnId, 'LIKE', true);
  },
  PARTIAL_ILIKE: (columnAccessor, value, columnId) => {
    return handleLike(columnAccessor, value, columnId, 'ILIKE', true);
  },

  EQUALS: (columnAccessor, value, columnId) => {
    // Allow 0, false, but reject null, undefined, empty string
    if (value === null || value === undefined || value === '') {
      logger.warn(
        'Core',
        `[FilterFactory] Column "${columnId}" has empty value for EQUALS filter.`,
      );
      return undefined;
    }
    return mSql.eq(mSql.column(columnAccessor), mSql.literal(value));
  },
};

function handleLike(
  columnAccessor: string,
  value: unknown,
  columnId: string | undefined,
  operator: 'LIKE' | 'ILIKE',
  isPartial: boolean,
): FilterExpr | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    logger.warn(
      'Core',
      `[FilterFactory] Column "${columnId}" has invalid value for text filter. Expected non-empty string.`,
      { value },
    );
    return undefined;
  }

  let pattern: string;
  if (isPartial) {
    // Hardening: Escape wildcards so "100%" means literal 100%, not "100[anything]"
    pattern = `%${escapeSqlLikePattern(value)}%`;
  } else {
    pattern = value;
  }

  // mSql.literal handles SQL Injection safety (quote escaping)
  return mSql.sql`${mSql.column(columnAccessor)} ${operator} ${mSql.literal(pattern)}`;
}

export function createFilterClause(
  sqlColumn: string,
  filterType: MosaicDataTableSqlFilterType = DEFAULT_SQL_FILTER_TYPE,
  value: unknown,
  columnId?: string,
): FilterExpr | undefined {
  const strategy = strategies[filterType];
  return strategy(sqlColumn, value, columnId);
}
