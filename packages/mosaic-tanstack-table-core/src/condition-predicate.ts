import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess, createTypedAccess } from './utils';
import { SqlIdentifier } from './domain/sql-identifier';

import type { FilterExpr } from '@uwdata/mosaic-sql';
import type {
  ConditionComparableValue,
  ConditionValue,
  FilterOperator,
} from './types';

type ConditionDataType = 'string' | 'number' | 'date' | 'boolean';

export interface BuildConditionPredicateOptions {
  column: string | SqlIdentifier;
  operator: FilterOperator;
  value?: ConditionValue | null;
  valueTo?: ConditionComparableValue | null;
  dataType?: ConditionDataType;
}

export function buildConditionPredicate(
  options: BuildConditionPredicateOptions,
): FilterExpr | undefined {
  const { column, operator, value, valueTo, dataType = 'string' } = options;
  const columnAccessor =
    typeof column === 'string' ? SqlIdentifier.from(column) : column;
  const rawCol = createStructAccess(columnAccessor);
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
    case 'contains':
      return isValidValue
        ? mSql.sql`${rawCol} ILIKE ${mSql.literal(`%${value}%`)}`
        : undefined;
    case 'not_contains':
      return isValidValue
        ? mSql.sql`${rawCol} NOT ILIKE ${mSql.literal(`%${value}%`)}`
        : undefined;
    case 'starts_with':
      return isValidValue
        ? mSql.sql`${rawCol} ILIKE ${mSql.literal(`${value}%`)}`
        : undefined;
    case 'not_starts_with':
      return isValidValue
        ? mSql.sql`${rawCol} NOT ILIKE ${mSql.literal(`${value}%`)}`
        : undefined;
    case 'ends_with':
      return isValidValue
        ? mSql.sql`${rawCol} ILIKE ${mSql.literal(`%${value}`)}`
        : undefined;
    case 'not_ends_with':
      return isValidValue
        ? mSql.sql`${rawCol} NOT ILIKE ${mSql.literal(`%${value}`)}`
        : undefined;
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
        const list = value.map((item) => mSql.literal(item));
        const listSql = mSql.sql`(${list.join(', ')})`;
        return mSql.sql`${col} NOT IN ${listSql}`;
      }
      return undefined;
    default:
      return undefined;
  }
}
