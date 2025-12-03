import type { RowData, TableOptions, TableState } from '@tanstack/table-core';

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
  // Handle null and undefined
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
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date;
    }

    // Trim whitespace
    const trimmed = value.trim();

    // Empty string should return null
    if (trimmed === '') {
      return null;
    }

    const num = Number(trimmed);
    return isFinite(num) ? num : null;
  }

  // Try coercing other types (like objects with valueOf, etc.)
  const num = Number(value);
  return isFinite(num) ? num : null;
}
