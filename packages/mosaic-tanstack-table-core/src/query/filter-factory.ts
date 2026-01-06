import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess, escapeSqlLikePattern } from '../utils';
import type { SqlIdentifier } from '../domain/sql-identifier';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { FilterValue } from '../types';

/**
 * A strictly typed filter strategy function.
 * It receives a validated `input` object (Discriminated Union) instead of `unknown`.
 */
export type FilterStrategy = (options: {
  columnAccessor: SqlIdentifier;
  input: FilterValue;
  columnId?: string;
}) => FilterExpr | undefined;

const strategies: Record<string, FilterStrategy> = {
  RANGE: ({ columnAccessor, input }) => {
    // Strict guard: Strategy only handles 'range' inputs
    if (input.type !== 'range') {
      return undefined;
    }

    const [min, max] = input.value;
    const colExpr = createStructAccess(columnAccessor);

    // Build SQL clauses
    // Note: We assume valid numbers here because Zod/Input validation happened upstream
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
    if (input.type !== 'text') {
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
    if (input.type !== 'text') {
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
    if (input.type !== 'text') {
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
    if (input.type !== 'text') {
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
    // Handles Text or Select inputs
    if (input.type !== 'text' && input.type !== 'select') {
      return undefined;
    }

    // Allow 0, false, but reject empty string
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
