/**
 * Utility functions for state management, SQL generation, and data type coercion.
 */

import * as mSql from '@uwdata/mosaic-sql';
import type {
  ColumnDef,
  RowData,
  TableOptions,
  TableState,
} from '@tanstack/table-core';
import type { SqlIdentifier } from './domain/sql-identifier';
import type { MosaicDataTableColumnDefMetaOptions } from './types';

/**
 * Utility to handle functional or direct value updates.
 * @param updater - value or function to produce the new value
 * @param old - the current value
 * @returns the updated value
 */
export function functionalUpdate<T>(updater: T | ((old: T) => T), old: T): T {
  return typeof updater === 'function'
    ? (updater as (old: T) => T)(old)
    : updater;
}

/**
 * Sanitises a string so it can be safely used as a SQL column name.
 * - Keeps letters, numbers, underscores, and dots (for table.column)
 * - Strips everything else
 * - Ensures it starts with a letter or underscore
 * - Optionally quotes the result to prevent reserved word issues
 * @param input - The input string to sanitise
 * @returns The sanitised SQL column name
 */
export function toSafeSqlColumnName(input: string): string {
  // Trim and normalise whitespace
  let name = input.trim();

  // Remove unsafe characters (only allow letters, numbers, underscores, and dots)
  name = name.replace(/[^a-zA-Z0-9_.]/g, '');

  // Ensure it starts with a valid character (a letter or underscore)
  if (!/^[a-zA-Z_]/.test(name)) {
    name = '_' + name;
  }

  return name;
}

/**
 * Escapes characters that have special meaning in SQL LIKE patterns.
 * DuckDB uses backslash (\) as the default escape character.
 *
 * @param input - The raw user input string
 * @returns The string with %, _, and \ escaped (e.g., "100%" -> "100\%")
 */
export function escapeSqlLikePattern(input: string): string {
  // Replace backslash first to avoid double-escaping later replacements
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Utility to seed initial table state with defaults.
 * @param initial - The initial state to seed from
 * @returns The seeded table state
 */
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
  // Handle null and undefined explicitly
  if (value === null || value === undefined) {
    return null;
  }

  // If it's already a number
  if (typeof value === 'number') {
    // Check for NaN and Infinity
    return isFinite(value) ? value : null;
  }

  // If it's a boolean, coerce it
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  // If it's a Date, return it
  if (value instanceof Date) {
    return value;
  }

  // If it's a string, try to coerce it
  if (typeof value === 'string') {
    const trimmed = value.trim();

    // Empty string should return null
    if (trimmed === '') {
      return null;
    }

    // if simple numbers are entered.
    // We check if it is a valid number first.
    const num = Number(trimmed);
    if (!isNaN(num) && isFinite(num)) {
      return num;
    }

    // If not a number, try Date
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date;
    }

    return null;
  }

  // Fallback for other types
  const num = Number(value);
  return isFinite(num) ? num : null;
}

/**
 * Represents a valid AST node used in Mosaic SQL generation.
 * Can be a standard SQL template literal or a Column reference.
 */
export type MosaicSQLExpression =
  | ReturnType<typeof mSql.sql>
  | ReturnType<typeof mSql.column>;

/**
 * Constructs a Mosaic SQL expression for a struct column access.
 * Uses the Mosaic AST to safely compose column references.
 *
 * Input: SqlIdentifier("related_phrase.phrase")
 * Output: sql`${column("related_phrase")}.${column("phrase")}`
 * SQL Result: "related_phrase"."phrase"
 */
export function createStructAccess(column: SqlIdentifier): MosaicSQLExpression {
  const columnPath = column.toString();

  // If it's a simple column, just return the column node
  if (!columnPath.includes('.')) {
    return mSql.column(columnPath);
  }

  const parts = columnPath.split('.');
  const [first, ...rest] = parts;

  if (!first) {
    throw new Error(`Invalid column path: ${columnPath}`);
  }

  // Reduce the parts into a nested SQL expression
  // Initialize accumulator with the first column part to avoid 'null' casting
  return rest.reduce(
    (acc, part) => {
      // Append subsequent parts with a dot separator.
      // mSql.column(part) ensures correct quoting.
      // mSql.sql`` creates the composite Expression Node.
      return mSql.sql`${acc}.${mSql.column(part)}`;
    },
    mSql.column(first) as MosaicSQLExpression,
  );
}

/**
 * Creates a typed SQL accessor expression using DuckDB's TRY_CAST.
 * This allows flexible filtering (e.g. numeric filter on string column) without
 * crashing query execution on invalid data.
 *
 * It acts as a Just-In-Time schema correction mechanism for user queries.
 */
export function createTypedAccess(
  colExpr: MosaicSQLExpression,
  targetType: 'string' | 'number' | 'date' | 'boolean',
) {
  if (targetType === 'number') {
    // DuckDB specific syntax for safe casting.
    // Returns NULL if the conversion fails (e.g. casting "abc" to DOUBLE)
    return mSql.sql`TRY_CAST(${colExpr} AS DOUBLE)`;
  }
  if (targetType === 'date') {
    return mSql.sql`TRY_CAST(${colExpr} AS TIMESTAMP)`;
  }
  // Default: Return as is (implicit casting or raw string)
  return colExpr;
}

// --- Column Helper Utilities ---

type UnwrapNullable<T> = T extends null | undefined
  ? never
  : T extends Array<infer U>
    ? U
    : T;

type FilterVariantFor<TValue> =
  UnwrapNullable<TValue> extends number
    ? 'range' | 'select'
    : UnwrapNullable<TValue> extends Date
      ? 'range' /* date range */
      : 'text' | 'select';

/**
 * Type-safe column helper factory for Mosaic Tables.
 *
 * This utility infers the `TValue` of the column based on the accessor key of `TData`.
 * It eliminates the need to manually pass `any` or strict types to `ColumnDef`.
 *
 * It also restricts `meta` options based on the inferred type of the column.
 *
 * @example
 * const helper = createMosaicColumnHelper<User>();
 * const columns = [
 *   helper.accessor('name', { header: 'Full Name' }),
 *   helper.accessor('age', { header: 'Age', cell: info => info.getValue().toFixed(0) }) // getValue() is number
 * ];
 */
export function createMosaicColumnHelper<TData extends RowData>() {
  return {
    accessor: <TKey extends keyof TData>(
      key: TKey,
      // TData[TKey] is inferred as the value type
      def: Omit<ColumnDef<TData, TData[TKey]>, 'meta'> & {
        meta?: MosaicDataTableColumnDefMetaOptions<TData[TKey]> & {
          mosaicDataTable?: {
            // Constrain the filterVariant based on TData[TKey]
            filterVariant?: FilterVariantFor<TData[TKey]>;
          };
        } & Record<string, any>;
      } = {},
    ): ColumnDef<TData, TData[TKey]> => {
      return {
        accessorKey: key as string,
        ...def,
      } as ColumnDef<TData, TData[TKey]>;
    },
  };
}