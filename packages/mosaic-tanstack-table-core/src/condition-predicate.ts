import * as mSql from '@uwdata/mosaic-sql';
import {
  createStructAccess,
  createTypedAccess,
  escapeSqlLikePattern,
} from './utils';
import { SqlIdentifier } from './domain/sql-identifier';

import type { FilterExpr } from '@uwdata/mosaic-sql';
import type {
  ColumnType,
  ConditionComparableValue,
  ConditionValue,
  FilterOperator,
} from './types';

export type ConditionDataType = 'string' | 'number' | 'date' | 'boolean';

export interface BuildConditionPredicateOptions {
  column: string | SqlIdentifier;
  operator: FilterOperator;
  value?: ConditionValue | null;
  valueTo?: ConditionComparableValue | null;
  dataType?: ConditionDataType;
}

export interface BuildEmptyValuePredicateOptions {
  column: string | SqlIdentifier;
  dataType?: ConditionDataType;
  columnType?: ColumnType;
  negate?: boolean;
}

export interface BuildCollectionPredicateOptions {
  column: string | SqlIdentifier;
  values: Array<ConditionComparableValue>;
  dataType?: ConditionDataType;
  columnType?: ColumnType;
  match?: 'any' | 'all';
  negate?: boolean;
}

function createColumnAccess(column: string | SqlIdentifier) {
  const columnAccessor =
    typeof column === 'string' ? SqlIdentifier.from(column) : column;
  const rawCol = createStructAccess(columnAccessor);

  return { columnAccessor, rawCol };
}

function createListLiteral(values: Array<ConditionComparableValue>) {
  const [firstValue, ...rest] = values;
  if (firstValue === undefined) {
    return undefined;
  }

  const listContent = rest.reduce<
    ReturnType<typeof mSql.literal> | ReturnType<typeof mSql.sql>
  >((acc, item) => {
    return mSql.sql`${acc}, ${mSql.literal(item)}`;
  }, mSql.literal(firstValue));

  return mSql.sql`[${listContent}]`;
}

function createSqlInList(values: Array<ConditionComparableValue>) {
  const list = values.map((item) => mSql.literal(item));
  return mSql.sql`(${list.join(', ')})`;
}

function createLikePattern(
  value: ConditionValue | null | undefined,
  position: 'contains' | 'starts_with' | 'ends_with',
) {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  const escaped = escapeSqlLikePattern(value);
  if (position === 'contains') {
    return `%${escaped}%`;
  }
  if (position === 'starts_with') {
    return `${escaped}%`;
  }
  return `%${escaped}`;
}

export function buildEmptyValuePredicate(
  options: BuildEmptyValuePredicateOptions,
): FilterExpr {
  const {
    column,
    dataType = 'string',
    columnType = 'scalar',
    negate = false,
  } = options;
  const { rawCol } = createColumnAccess(column);

  if (columnType === 'array') {
    if (negate) {
      return mSql.sql`${rawCol} IS NOT NULL AND array_length(${rawCol}) > 0`;
    }

    return mSql.sql`${rawCol} IS NULL OR array_length(${rawCol}) = 0`;
  }

  if (dataType === 'string') {
    if (negate) {
      return mSql.sql`${rawCol} IS NOT NULL AND ${rawCol} != ''`;
    }

    return mSql.sql`${rawCol} IS NULL OR ${rawCol} = ''`;
  }

  if (negate) {
    return mSql.sql`${rawCol} IS NOT NULL`;
  }

  return mSql.sql`${rawCol} IS NULL`;
}

export function buildCollectionPredicate(
  options: BuildCollectionPredicateOptions,
): FilterExpr | undefined {
  const {
    column,
    values,
    dataType = 'string',
    columnType = 'scalar',
    match = 'any',
    negate = false,
  } = options;

  if (values.length === 0) {
    return undefined;
  }

  const { rawCol } = createColumnAccess(column);

  if (columnType === 'array') {
    const listLiteral = createListLiteral(values);
    if (!listLiteral) {
      return undefined;
    }

    const clause =
      match === 'all'
        ? mSql.sql`list_has_all(${rawCol}, ${listLiteral})`
        : mSql.sql`list_has_any(${rawCol}, ${listLiteral})`;
    return negate ? mSql.sql`NOT (${clause})` : clause;
  }

  if (match !== 'any') {
    return undefined;
  }

  const typedCol = createTypedAccess(rawCol, dataType);

  if (negate) {
    return mSql.sql`${typedCol} NOT IN ${createSqlInList(values)}`;
  }

  return mSql.isIn(
    typedCol,
    values.map((item) => mSql.literal(item)),
  );
}

export function buildConditionPredicate(
  options: BuildConditionPredicateOptions,
): FilterExpr | undefined {
  const { column, operator, value, valueTo, dataType = 'string' } = options;
  const { rawCol } = createColumnAccess(column);
  const col = createTypedAccess(rawCol, dataType);
  const isValidValue = value !== null && value !== undefined && value !== '';
  const isValidValueTo =
    valueTo !== null && valueTo !== undefined && valueTo !== '';

  switch (operator) {
    case 'is_null':
      return mSql.sql`${rawCol} IS NULL`;
    case 'not_null':
      return mSql.sql`${rawCol} IS NOT NULL`;
    case 'eq':
      if (!isValidValue) {
        return undefined;
      }
      return mSql.eq(col, mSql.literal(value));
    case 'neq':
      if (!isValidValue) {
        return undefined;
      }
      return mSql.sql`${col} != ${mSql.literal(value)}`;
    case 'gt':
      if (!isValidValue) {
        return undefined;
      }
      return mSql.gt(col, mSql.literal(value));
    case 'gte':
      if (!isValidValue) {
        return undefined;
      }
      return mSql.gte(col, mSql.literal(value));
    case 'lt':
      if (!isValidValue) {
        return undefined;
      }
      return mSql.lt(col, mSql.literal(value));
    case 'lte':
      if (!isValidValue) {
        return undefined;
      }
      return mSql.lte(col, mSql.literal(value));
    case 'contains': {
      const pattern = createLikePattern(value, 'contains');
      return pattern
        ? mSql.sql`${rawCol} ILIKE ${mSql.literal(pattern)} ESCAPE '\\'`
        : undefined;
    }
    case 'not_contains': {
      const pattern = createLikePattern(value, 'contains');
      return pattern
        ? mSql.sql`${rawCol} NOT ILIKE ${mSql.literal(pattern)} ESCAPE '\\'`
        : undefined;
    }
    case 'starts_with': {
      const pattern = createLikePattern(value, 'starts_with');
      return pattern
        ? mSql.sql`${rawCol} ILIKE ${mSql.literal(pattern)} ESCAPE '\\'`
        : undefined;
    }
    case 'not_starts_with': {
      const pattern = createLikePattern(value, 'starts_with');
      return pattern
        ? mSql.sql`${rawCol} NOT ILIKE ${mSql.literal(pattern)} ESCAPE '\\'`
        : undefined;
    }
    case 'ends_with': {
      const pattern = createLikePattern(value, 'ends_with');
      return pattern
        ? mSql.sql`${rawCol} ILIKE ${mSql.literal(pattern)} ESCAPE '\\'`
        : undefined;
    }
    case 'not_ends_with': {
      const pattern = createLikePattern(value, 'ends_with');
      return pattern
        ? mSql.sql`${rawCol} NOT ILIKE ${mSql.literal(pattern)} ESCAPE '\\'`
        : undefined;
    }
    case 'between':
      if (isValidValue && isValidValueTo) {
        return mSql.isBetween(col, [
          mSql.literal(value),
          mSql.literal(valueTo),
        ]);
      }
      return undefined;
    case 'in':
      if (Array.isArray(value) && value.length > 0) {
        return mSql.isIn(
          col,
          value.map((item) => mSql.literal(item)),
        );
      }
      return undefined;
    case 'not_in':
      if (Array.isArray(value) && value.length > 0) {
        return mSql.sql`${col} NOT IN ${createSqlInList(value)}`;
      }
      return undefined;
    default:
      return undefined;
  }
}
