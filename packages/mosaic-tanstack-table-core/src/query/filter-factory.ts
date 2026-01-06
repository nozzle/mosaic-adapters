import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess, escapeSqlLikePattern } from '../utils';
import type { SqlIdentifier } from '../domain/sql-identifier';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { FilterInput } from '../types';

/**
 * A strictly typed filter strategy function.
 * Receives the Discriminated Union `FilterInput`.
 * Converts specific inputs into Mosaic SQL Expression Nodes.
 */
export type FilterStrategy = (options: {
  columnAccessor: SqlIdentifier;
  input: FilterInput;
  columnId?: string;
}) => FilterExpr | undefined;

const strategies: Record<string, FilterStrategy> = {
  RANGE: ({ columnAccessor, input }) => {
    // Discriminated union match
    if (input.mode !== 'RANGE') {
      return undefined;
    }

    const [min, max] = input.value;
    const colExpr = createStructAccess(columnAccessor);

    // SQL Generation for Numbers (Handle Open Ranges)
    if (min !== null && max !== null) {
      return mSql.isBetween(colExpr, [mSql.literal(min), mSql.literal(max)]);
    } else if (min !== null) {
      return mSql.gte(colExpr, mSql.literal(min));
    } else if (max !== null) {
      return mSql.lte(colExpr, mSql.literal(max));
    }
    return undefined;
  },

  DATE_RANGE: ({ columnAccessor, input }) => {
    // Discriminated union match for Temporal types
    if (input.mode !== 'DATE_RANGE') {
      return undefined;
    }

    // Treat empty strings as null for open-ended ranges
    const minVal = input.value[0];
    const maxVal = input.value[1];

    const min = minVal !== null && minVal !== '' ? String(minVal) : null;
    const max = maxVal !== null && maxVal !== '' ? String(maxVal) : null;

    const colExpr = createStructAccess(columnAccessor);

    // FIX: Remove invalid explicit type mSql.SQLExpression
    let finalMin = null;
    let finalMax = null;

    // Process min value
    if (min !== null) {
      // DuckDB's TIMESTAMP type typically expects UTC if no timezone is specified.
      // We check the RAW value (minVal) for Date instance, as 'min' is already coerced to string.
      if ((minVal as unknown) instanceof Date) {
        finalMin = mSql.literal(
          (minVal as unknown as Date).toISOString().split('T')[0] ?? '',
        ); // Just the date part
      } else {
        finalMin = mSql.literal(min);
      }
    }

    // Process max value
    if (max !== null) {
      if ((maxVal as unknown) instanceof Date) {
        finalMax = mSql.literal(
          (maxVal as unknown as Date).toISOString().split('T')[0] ?? '',
        ); // Just the date part
      } else {
        finalMax = mSql.literal(max);
      }
    }

    // SQL Generation for Dates/Strings
    if (finalMin !== null && finalMax !== null) {
      return mSql.isBetween(colExpr, [finalMin, finalMax]);
    } else if (finalMin !== null) {
      return mSql.gte(colExpr, finalMin);
    } else if (finalMax !== null) {
      return mSql.lte(colExpr, finalMax);
    }
    return undefined;
  },

  ILIKE: ({ columnAccessor, input }) => {
    if (input.mode !== 'TEXT') {
      return undefined;
    }
    return handleLike({
      columnAccessor,
      value: input.value,
      operator: 'ILIKE',
      isPartial: false,
    });
  },

  LIKE: ({ columnAccessor, input }) => {
    if (input.mode !== 'TEXT') {
      return undefined;
    }
    return handleLike({
      columnAccessor,
      value: input.value,
      operator: 'LIKE',
      isPartial: false,
    });
  },

  PARTIAL_LIKE: ({ columnAccessor, input }) => {
    if (input.mode !== 'TEXT') {
      return undefined;
    }
    return handleLike({
      columnAccessor,
      value: input.value,
      operator: 'LIKE',
      isPartial: true,
    });
  },

  PARTIAL_ILIKE: ({ columnAccessor, input }) => {
    if (input.mode !== 'TEXT') {
      return undefined;
    }
    return handleLike({
      columnAccessor,
      value: input.value,
      operator: 'ILIKE',
      isPartial: true,
    });
  },

  EQUALS: ({ columnAccessor, input }) => {
    // Supports TEXT, MATCH, SELECT modes
    if (
      input.mode !== 'TEXT' &&
      input.mode !== 'MATCH' &&
      input.mode !== 'SELECT'
    ) {
      return undefined;
    }

    if (input.value === '') {
      return undefined;
    }

    return mSql.eq(
      createStructAccess(columnAccessor),
      mSql.literal(input.value),
    );
  },
};

function handleLike(options: {
  columnAccessor: SqlIdentifier;
  value: string;
  operator: 'LIKE' | 'ILIKE';
  isPartial: boolean;
}): FilterExpr | undefined {
  if (options.value.length === 0) {
    return undefined;
  }

  let pattern = options.value;
  if (options.isPartial) {
    pattern = `%${escapeSqlLikePattern(options.value)}%`;
  }

  const colExpr = createStructAccess(options.columnAccessor);
  const patternLiteral = mSql.literal(pattern);

  if (options.operator === 'ILIKE') {
    return mSql.sql`${colExpr} ILIKE ${patternLiteral}`;
  } else {
    return mSql.sql`${colExpr} LIKE ${patternLiteral}`;
  }
}

export const defaultFilterStrategies = strategies;
