import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess } from '../utils';
import { SqlIdentifier } from '../domain/sql-identifier';
import type {
  MosaicDataTableOptions,
  PrimitiveSqlValue,
  RowSelectionMode,
} from '../types';
import type { FilterExpr } from '@uwdata/mosaic-sql';
import type { RowData } from '@tanstack/table-core';

export type RowIdentityConfig = {
  fields: Array<string>;
  mode: RowSelectionMode;
  getRowId?: (row: Record<string, unknown>) => string;
};

export function resolveRowIdentity<TData extends RowData, TValue = unknown>(
  options: MosaicDataTableOptions<TData, TValue>,
): RowIdentityConfig {
  const mode = options.rowSelectionMode ?? 'row-id';
  const fields = normalizeRowIdFields(options);

  return {
    fields,
    mode,
    getRowId: options.getRowId,
  };
}

export function getRowIdentityFields(
  identity: RowIdentityConfig,
): Array<string> | undefined {
  if (identity.mode !== 'row-id') {
    return undefined;
  }
  if (identity.fields.length === 0) {
    return undefined;
  }
  return identity.fields;
}

export function createRowIdentityGetter(
  identity: RowIdentityConfig,
): ((row: Record<string, unknown>) => string) | undefined {
  if (identity.getRowId) {
    return identity.getRowId;
  }
  if (identity.mode !== 'row-id' || identity.fields.length === 0) {
    return undefined;
  }

  return (row) =>
    serializeRowIdentityValues(readRowIdentityValues(row, identity));
}

export function readRowIdentityValues(
  row: Record<string, unknown>,
  identity: RowIdentityConfig,
): Array<PrimitiveSqlValue> {
  return identity.fields.map((field) => row[field] as PrimitiveSqlValue);
}

export function serializeRowIdentityValues(
  values: Array<PrimitiveSqlValue>,
): string {
  if (values.length === 1) {
    return String(values[0]);
  }
  return JSON.stringify(values);
}

export function deserializeRowIdentityValue(
  rowId: string,
  identity: RowIdentityConfig,
): Array<PrimitiveSqlValue> {
  if (identity.fields.length <= 1) {
    return [rowId];
  }

  try {
    const parsed = JSON.parse(rowId) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as Array<PrimitiveSqlValue>;
    }
  } catch {
    return [];
  }

  return [];
}

export function buildRowIdentityPredicate(
  identity: RowIdentityConfig,
  rowIds: Array<string>,
): FilterExpr | null {
  if (identity.mode !== 'row-id' || identity.fields.length === 0) {
    return null;
  }
  if (rowIds.length === 0) {
    return null;
  }

  const fields = identity.fields.map((field) =>
    createStructAccess(SqlIdentifier.from(field)),
  );
  const rowValues = rowIds
    .map((rowId) => deserializeRowIdentityValue(rowId, identity))
    .filter((values) => values.length === fields.length);

  if (rowValues.length === 0) {
    return null;
  }

  if (fields.length === 1) {
    return mSql.isIn(
      fields[0]!,
      rowValues.map((values) => mSql.literal(values[0])),
    );
  }

  const clauses = rowValues.map((values) =>
    mSql.and(
      ...values.map((value, index) =>
        mSql.isNotDistinct(fields[index]!, mSql.literal(value)),
      ),
    ),
  );

  return clauses.length === 1 ? clauses[0]! : mSql.or(...clauses);
}

function normalizeRowIdFields<TData extends RowData, TValue = unknown>(
  options: MosaicDataTableOptions<TData, TValue>,
): Array<string> {
  if (Array.isArray(options.rowId)) {
    return options.rowId.filter((field) => field.trim().length > 0);
  }
  if (typeof options.rowId === 'string' && options.rowId.trim().length > 0) {
    return [options.rowId];
  }
  if (options.rowSelectionMode === 'row-values') {
    return [];
  }
  if (options.rowSelection?.column) {
    return [options.rowSelection.column];
  }
  return [];
}
