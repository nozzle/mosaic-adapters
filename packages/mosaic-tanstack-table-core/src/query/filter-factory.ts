import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess, escapeSqlLikePattern } from '../utils';
import type { SqlIdentifier } from '../domain/sql-identifier';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { FilterInput } from '../types';

/**
 * A strictly typed filter strategy function.
 * Receives the Discriminated Union `FilterInput`.
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
