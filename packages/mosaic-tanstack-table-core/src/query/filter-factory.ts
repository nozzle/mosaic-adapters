import * as mSql from '@uwdata/mosaic-sql';
import { logger } from '../logger';
import {
  createStructAccess,
  createTypedAccess,
  escapeSqlLikePattern,
} from '../utils';
import { buildConditionPredicate } from '../condition-predicate';
import type { SqlIdentifier } from '../domain/sql-identifier';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { FilterInput, FilterOptions } from '../types';

/**
 * A strictly typed filter strategy function.
 * Receives the Discriminated Union `FilterInput`.
 * Converts specific inputs into Mosaic SQL Expression Nodes.
 */
export type FilterStrategy = (options: {
  columnAccessor: SqlIdentifier;
  input: FilterInput;
  columnId?: string;
  filterOptions?: FilterOptions;
}) => FilterExpr | undefined;

const strategies: Record<string, FilterStrategy> = {
  CONDITION: ({ columnAccessor, input, columnId }) => {
    if (input.mode !== 'CONDITION') {
      return undefined;
    }

    const { operator, value, valueTo, dataType = 'string' } = input;

    // Use logger instead of console.log for debug traceability
    logger.debug(
      'Core',
      `[FilterStrategy:CONDITION] Building filter for ${columnId}. DataType: ${dataType}`,
      input,
    );
    const expr = buildConditionPredicate({
      column: columnAccessor,
      operator,
      value,
      valueTo,
      dataType,
    });

    if (expr) {
      logger.debug(
        'SQL',
        `[FilterStrategy:CONDITION] Generated SQL: ${expr.toString()}`,
      );
    } else {
      logger.debug(
        'Core',
        `[FilterStrategy:CONDITION] Skipped SQL generation (invalid inputs).`,
        input,
      );
    }

    return expr;
  },

  RANGE: ({ columnAccessor, input }) => {
    // Discriminated union match
    if (input.mode !== 'RANGE') {
      return undefined;
    }

    const [min, max] = input.value;
    // For range filters, we assume numeric intent if using this mode
    const rawCol = createStructAccess(columnAccessor);
    const colExpr = createTypedAccess(rawCol, 'number');

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

  DATE_RANGE: ({ columnAccessor, input, filterOptions }) => {
    if (input.mode !== 'DATE_RANGE') {
      return undefined;
    }

    const minVal = input.value[0];
    const maxVal = input.value[1];

    const min = minVal !== null && minVal !== '' ? String(minVal) : null;
    const max = maxVal !== null && maxVal !== '' ? String(maxVal) : null;

    const rawCol = createStructAccess(columnAccessor);
    const colExpr = createTypedAccess(rawCol, 'date');

    const convertToUTC = filterOptions?.convertToUTC;

    let finalMin = null;
    let finalMax = null;

    const toUTC = (val: string) => {
      const d = new Date(val);
      return !isNaN(d.getTime()) ? d.toISOString() : val;
    };

    if (min !== null) {
      if (convertToUTC && min.includes('T')) {
        finalMin = mSql.literal(toUTC(min));
      } else if ((minVal as unknown) instanceof Date) {
        finalMin = mSql.literal(
          (minVal as unknown as Date).toISOString().split('T')[0] ?? '',
        );
      } else {
        finalMin = mSql.literal(min);
      }
    }

    if (max !== null) {
      if (convertToUTC && max.includes('T')) {
        finalMax = mSql.literal(toUTC(max));
      } else if ((maxVal as unknown) instanceof Date) {
        finalMax = mSql.literal(
          (maxVal as unknown as Date).toISOString().split('T')[0] ?? '',
        );
      } else {
        finalMax = mSql.literal(max);
      }
    }

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
