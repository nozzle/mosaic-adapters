import * as mSql from '@uwdata/mosaic-sql';
import { escapeSqlLikePattern, toRangeValue } from '../utils';
import { logger } from '../logger';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { MosaicDataTableSqlFilterType } from '../types';

type FilterStrategy = (options: {
  columnAccessor: string;
  value: unknown;
  columnId?: string;
}) => FilterExpr | undefined;

const DEFAULT_SQL_FILTER_TYPE: MosaicDataTableSqlFilterType = 'EQUALS';

const strategies: Record<MosaicDataTableSqlFilterType, FilterStrategy> = {
  RANGE: ({ columnAccessor, value, columnId }) => {
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

    if (min === null && max === null) {
      return undefined;
    }

    let clause: FilterExpr | undefined = undefined;

    // Build SQL clauses using Mosaic literals to handle type safety
    if (max === null) {
      // GREATER THAN OR EQUAL TO min
      clause = mSql.gte(mSql.column(columnAccessor), mSql.literal(min));
    } else if (min === null) {
      // LESS THAN OR EQUAL TO max
      clause = mSql.lte(mSql.column(columnAccessor), mSql.literal(max));
    } else {
      // BETWEEN min AND max
      clause = mSql.isBetween(mSql.column(columnAccessor), [
        mSql.literal(min),
        mSql.literal(max),
      ]);
    }

    return clause;
  },

  ILIKE: ({ columnAccessor, value, columnId }) => {
    return handleLike({
      columnAccessor,
      value,
      columnId,
      operator: 'ILIKE',
      isPartial: false,
    });
  },
  LIKE: ({ columnAccessor, value, columnId }) => {
    return handleLike({
      columnAccessor,
      value,
      columnId,
      operator: 'LIKE',
      isPartial: false,
    });
  },
  PARTIAL_LIKE: ({ columnAccessor, value, columnId }) => {
    return handleLike({
      columnAccessor,
      value,
      columnId,
      operator: 'LIKE',
      isPartial: true,
    });
  },
  PARTIAL_ILIKE: ({ columnAccessor, value, columnId }) => {
    return handleLike({
      columnAccessor,
      value,
      columnId,
      operator: 'ILIKE',
      isPartial: true,
    });
  },

  EQUALS: ({ columnAccessor, value, columnId }) => {
    // Allow 0, false, but reject null, undefined, empty string
    if (value === null || value === undefined || value === '') {
      logger.warn(
        'Core',
        `[FilterFactory] Column "${columnId}" has empty value for EQUALS filter.`,
      );
      return undefined;
    }
    const clause = mSql.eq(mSql.column(columnAccessor), mSql.literal(value));

    return clause;
  },
};

function handleLike(options: {
  columnAccessor: string;
  value: unknown;
  columnId: string | undefined;
  operator: 'LIKE' | 'ILIKE';
  isPartial: boolean;
}): FilterExpr | undefined {
  if (typeof options.value !== 'string' || options.value.length === 0) {
    logger.warn(
      'Core',
      `[FilterFactory] Column "${options.columnId}" has invalid value for text filter. Expected non-empty string.`,
      { value: options.value },
    );
    return undefined;
  }

  let pattern: string;
  if (options.isPartial) {
    // Hardening: Escape wildcards so "100%" means literal 100%, not "100[anything]"
    pattern = `%${escapeSqlLikePattern(options.value)}%`;
  } else {
    pattern = options.value;
  }

  // mSql.literal handles SQL Injection safety (quote escaping)
  const clause = mSql.sql`${mSql.column(options.columnAccessor)} ${options.operator} ${mSql.literal(pattern)}`;

  return clause;
}

export function createFilterClause(options: {
  sqlColumn: string;
  value: unknown;
  filterType?: MosaicDataTableSqlFilterType;
  columnId?: string;
}): FilterExpr | undefined {
  const filterType = options.filterType || DEFAULT_SQL_FILTER_TYPE;
  const strategy = strategies[filterType];
  return strategy({
    columnAccessor: options.sqlColumn,
    value: options.value,
    columnId: options.columnId,
  });
}
