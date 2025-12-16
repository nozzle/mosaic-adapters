import * as mSql from '@uwdata/mosaic-sql';
import type { RowData, TableOptions, TableState } from '@tanstack/table-core';

// ... [Keep functionalUpdate, toSafeSqlColumnName, escapeSqlLikePattern, seedInitialTableState, toRangeValue as they are] ...

export function functionalUpdate<T>(updater: T | ((old: T) => T), old: T): T {
  return typeof updater === 'function'
    ? (updater as (old: T) => T)(old)
    : updater;
}

export function toSafeSqlColumnName(input: string): string {
  let name = input.trim();
  name = name.replace(/[^a-zA-Z0-9_.]/g, '');
  if (!/^[a-zA-Z_]/.test(name)) {
    name = '_' + name;
  }
  return name;
}

export function escapeSqlLikePattern(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function seedInitialTableState<TData extends RowData>(
  initial?: TableOptions<TData>['initialState'],
): TableState {
  return {
    pagination: {
      pageIndex: initial?.pagination?.pageIndex || 0,
      pageSize: initial?.pagination?.pageSize || 10,
    },
    columnFilters: initial?.columnFilters || [],
    columnVisibility: initial?.columnVisibility || {},
    columnOrder: initial?.columnOrder || [],
    columnPinning: {
      left: initial?.columnPinning?.left || [],
      right: initial?.columnPinning?.right || [],
    },
    rowPinning: {
      top: initial?.rowPinning?.top || [],
      bottom: initial?.rowPinning?.bottom || [],
    },
    globalFilter: initial?.globalFilter || undefined,
    sorting: initial?.sorting || [],
    expanded: initial?.expanded || {},
    grouping: initial?.grouping || [],
    columnSizing: initial?.columnSizing || {},
    columnSizingInfo: {
      columnSizingStart: initial?.columnSizingInfo?.columnSizingStart || [],
      deltaOffset: initial?.columnSizingInfo?.deltaOffset || null,
      deltaPercentage: initial?.columnSizingInfo?.deltaPercentage || null,
      isResizingColumn: initial?.columnSizingInfo?.isResizingColumn || false,
      startOffset: initial?.columnSizingInfo?.startOffset || null,
      startSize: initial?.columnSizingInfo?.startSize || null,
    },
    rowSelection: initial?.rowSelection || {},
  };
}

export function toRangeValue(value: unknown): number | Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    const num = Number(trimmed);
    if (!isNaN(num) && isFinite(num)) {
      return num;
    }
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date;
    }
    return null;
  }
  const num = Number(value);
  return isFinite(num) ? num : null;
}

type MosaicSQLExpression =
  | ReturnType<typeof mSql.sql>
  | ReturnType<typeof mSql.column>;

/**
 * Constructs a Mosaic SQL expression for a struct column access.
 * Uses the Mosaic AST to safely compose column references.
 *
 * Input: "related_phrase.phrase"
 * Output: sql`${column("related_phrase")}.${column("phrase")}`
 * SQL Result: "related_phrase"."phrase"
 */
export function createStructAccess(columnPath: string): MosaicSQLExpression {
  // If it's a simple column, just return the column node
  if (!columnPath.includes('.')) {
    return mSql.column(columnPath);
  }

  const parts = columnPath.split('.');

  // Reduce the parts into a nested SQL expression
  return parts.reduce(
    (acc, part, index) => {
      // First part is the base column (e.g. "related_phrase")
      if (index === 0) {
        return mSql.column(part);
      }

      // Subsequent parts are appended with a dot separator.
      // We wrap 'part' in mSql.column() so it gets quoted correctly ("phrase")
      // We wrap the whole thing in mSql.sql`` to create a composite Expression Node.
      return mSql.sql`${acc}.${mSql.column(part)}`;
    },
    null as unknown as MosaicSQLExpression,
  );
}
