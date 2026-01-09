import * as mSql from '@uwdata/mosaic-sql';
import {
  createStructAccess,
  createTypedAccess,
  escapeSqlLikePattern,
} from '../utils';
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

    // TRACE: Always log to console to debug missing filters
    console.log(
      `[FilterStrategy:CONDITION] Building filter for ${columnId}. DataType: ${dataType}`,
      input,
    );

    // 1. Get Base Column Expression
    const rawCol = createStructAccess(columnAccessor);

    // 2. Apply "Just-In-Time" Casting via TRY_CAST logic in utils
    // This allows robust filtering even if the underlying table schema is incorrect (e.g. numbers stored as text)
    const col = createTypedAccess(rawCol, dataType);

    // 3. Prepare Value Literal (Handle Dates, etc.)
    // SAFETY: Explicitly check for null/undefined/empty string to allow 0 (number) or false (boolean) as valid values.
    const isValidVal = value !== null && value !== undefined && value !== '';
    const isValidTo =
      valueTo !== null && valueTo !== undefined && valueTo !== '';

    // Create literals only if valid.
    // Note: mSql.literal() handles boolean/number/string correctly.
    const val = isValidVal ? mSql.literal(value) : null;
    const valTo = isValidTo ? mSql.literal(valueTo) : null;

    let expr: FilterExpr | undefined;

    switch (operator) {
      // Unary
      case 'is_null':
        expr = mSql.sql`${rawCol} IS NULL`; // No cast needed for null check
        break;
      case 'not_null':
        expr = mSql.sql`${rawCol} IS NOT NULL`;
        break;

      // Binary
      case 'eq':
        expr = val ? mSql.eq(col, val) : undefined;
        break;
      case 'neq':
        expr = val ? mSql.sql`${col} != ${val}` : undefined;
        break;
      case 'gt':
        expr = val ? mSql.gt(col, val) : undefined;
        break;
      case 'gte':
        expr = val ? mSql.gte(col, val) : undefined;
        break;
      case 'lt':
        expr = val ? mSql.lt(col, val) : undefined;
        break;
      case 'lte':
        expr = val ? mSql.lte(col, val) : undefined;
        break;

      // String specific (Likely ignored if dataType is number, but handled safely)
      case 'contains':
        // For contains, we likely want to search against the raw string or cast back to string
        expr = val
          ? mSql.sql`${rawCol} ILIKE ${mSql.literal(`%${value}%`)}`
          : undefined;
        break;
      case 'not_contains':
        expr = val
          ? mSql.sql`${rawCol} NOT ILIKE ${mSql.literal(`%${value}%`)}`
          : undefined;
        break;
      case 'starts_with':
        expr = val
          ? mSql.sql`${rawCol} ILIKE ${mSql.literal(`${value}%`)}`
          : undefined;
        break;
      case 'ends_with':
        expr = val
          ? mSql.sql`${rawCol} ILIKE ${mSql.literal(`%${value}`)}`
          : undefined;
        break;

      // Ternary
      case 'between':
        if (val && valTo) {
          expr = mSql.isBetween(col, [val, valTo]);
        }
        break;

      default:
        expr = undefined;
    }

    if (expr) {
      // TRACE: Log Success
      console.log(
        `[FilterStrategy:CONDITION] Generated SQL: ${expr.toString()}`,
      );
    } else {
      // TRACE: Log Failure
      console.warn(`[FilterStrategy:CONDITION] Failed to generate SQL.`, input);
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
    // Discriminated union match for Temporal types
    if (input.mode !== 'DATE_RANGE') {
      return undefined;
    }

    // Treat empty strings as null for open-ended ranges
    const minVal = input.value[0];
    const maxVal = input.value[1];

    const min = minVal !== null && minVal !== '' ? String(minVal) : null;
    const max = maxVal !== null && maxVal !== '' ? String(maxVal) : null;

    const rawCol = createStructAccess(columnAccessor);
    // Force temporal casting for date ranges
    const colExpr = createTypedAccess(rawCol, 'date');

    const convertToUTC = filterOptions?.convertToUTC;

    let finalMin = null;
    let finalMax = null;

    // Helper to convert Local String -> UTC ISO String
    const toUTC = (val: string) => {
      // If it contains T (e.g. 2023-01-01T12:00), parsing creates Local Date.
      // toISOString() converts that Local Date to UTC.
      const d = new Date(val);
      return !isNaN(d.getTime()) ? d.toISOString() : val;
    };

    // Process min value
    if (min !== null) {
      // Priority 1: Convert to UTC if flag is enabled (Handles Local -> UTC shift)
      if (convertToUTC && min.includes('T')) {
        finalMin = mSql.literal(toUTC(min));
      }
      // Priority 2: Handle raw Date objects (Legacy path)
      else if ((minVal as unknown) instanceof Date) {
        finalMin = mSql.literal(
          (minVal as unknown as Date).toISOString().split('T')[0] ?? '',
        );
      }
      // Priority 3: Raw string
      else {
        finalMin = mSql.literal(min);
      }
    }

    // Process max value
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
