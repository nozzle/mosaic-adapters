import * as mSql from '@uwdata/mosaic-sql';
import {
  createStructAccess,
  escapeSqlLikePattern,
  toRangeValue,
} from '../utils';
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

    // If both are null, we have no filter to apply
    if (min === null && max === null) {
      return undefined;
    }

    let clause: FilterExpr | undefined = undefined;

    // Use createStructAccess for struct columns in Range filters
    const colExpr = createStructAccess(columnAccessor);

    // Build SQL clauses using Mosaic literals to handle type safety
    if (max === null && min !== null) {
      // GREATER THAN OR EQUAL TO min
      clause = mSql.gte(colExpr, mSql.literal(min));
    } else if (min === null && max !== null) {
      // LESS THAN OR EQUAL TO max
      clause = mSql.lte(colExpr, mSql.literal(max));
    } else if (min !== null && max !== null) {
      // BETWEEN min AND max
      clause = mSql.isBetween(colExpr, [mSql.literal(min), mSql.literal(max)]);
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

  EQUALS: ({ columnAccessor, value, columnId: _unused }) => {
    // HARDENING: Reject Arrays. EQUALS strategy cannot handle Range/List value arrays.
    // This prevents crashes if a Range Filter accidentally falls back to EQUALS strategy.
    if (Array.isArray(value)) {
      // Optional: logger.warn('Core', `[FilterFactory] EQUALS strategy received an array value for column "${columnId}". Ignoring to prevent SQL errors.`);
      return undefined;
    }

    // Allow 0, false, but reject null, undefined, empty string
    if (value === null || value === undefined || value === '') {
      // Don't warn for empty strings as this is common in UI state (cleared filter)
      // logger.warn('Core', ...);
      return undefined;
    }

    // Use createStructAccess for struct columns in Equals filters
    const clause = mSql.eq(
      createStructAccess(columnAccessor),
      mSql.literal(value),
    );

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
  // Safe coercion to string to ensure even numeric inputs (ids) are handled if they ended up here.
  // Using String() handles null/undefined as "null"/"undefined", so we check existence first.
  if (options.value === null || options.value === undefined) {
    return undefined;
  }

  const valStr = String(options.value);
  if (valStr.length === 0) {
    // Empty search string = no filter
    return undefined;
  }

  let pattern = valStr;
  if (options.isPartial) {
    // Hardening: Escape wildcards so "100%" means literal 100%, not "100[anything]"
    pattern = `%${escapeSqlLikePattern(valStr)}%`;
  } else {
    pattern = valStr;
  }

  // Use createStructAccess for struct columns in Like filters
  const colExpr = createStructAccess(options.columnAccessor);
  const patternLiteral = mSql.literal(pattern);

  // Explicitly construct the SQL based on the operator type.
  if (options.operator === 'ILIKE') {
    return mSql.sql`${colExpr} ILIKE ${patternLiteral}`;
  } else {
    return mSql.sql`${colExpr} LIKE ${patternLiteral}`;
  }
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
