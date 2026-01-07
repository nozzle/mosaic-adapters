import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ClassValue } from 'clsx';
import type { Row } from '@tanstack/react-table';

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs));
}

export const simpleDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
});

/**
 * Converts a Date object or ISO string to the format required by HTML <input type="datetime-local" />
 * Format: "YYYY-MM-DDTHH:mm:ss" (Includes seconds for precision)
 *
 * This function handles strict idempotency for strings to prevent re-parsing drift
 * and uses UTC methods for Date objects to ensure database values (often UTC)
 * do not shift based on the user's local timezone.
 */
export function toDateTimeInputString(value: unknown): string {
  if (!value) {
    return '';
  }

  // Idempotency check: if it's already a string, assume it's in the correct format or safe to return.
  if (typeof value === 'string') {
    return value;
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (isNaN(date.getTime())) {
    return '';
  }

  const pad = (n: number) => n.toString().padStart(2, '0');

  // Use UTC methods to align with standard database storage of timestamps.
  const yyyy = date.getUTCFullYear();
  const MM = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mm = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());

  return `${yyyy}-${MM}-${dd}T${hh}:${mm}:${ss}`;
}

/**
 * Converts a Date object or ISO string to the format required by HTML <input type="date" />
 * Format: "YYYY-MM-DD"
 */
export function toDateInputString(value: unknown): string {
  if (!value) {
    return '';
  }

  // Idempotency check to prevent drift
  if (typeof value === 'string') {
    // Ensure we only return the Date part if it happens to be an ISO timestamp string
    // TS-Fix: Add fallback ?? '' to satisfy noUncheckedIndexedAccess
    return value.split('T')[0] ?? '';
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (isNaN(date.getTime())) {
    return '';
  }

  const pad = (n: number) => n.toString().padStart(2, '0');

  // Use UTC methods to ignore local timezone offsets
  const yyyy = date.getUTCFullYear();
  const MM = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());

  return `${yyyy}-${MM}-${dd}`;
}

export function isRowHighlighted<TData>(row: Row<TData>): boolean {
  // @ts-expect-error __is_highlighted is dynamically injected by Mosaic SQL logic
  const val = row.original.__is_highlighted;

  // If undefined, it means no highlight query is active (all rows visible).
  if (val === undefined) {
    return true;
  }

  // If defined, DuckDB returns BigInt (0n or 1n) or Number.
  // 0 means "dimmed/unselected", 1 means "highlighted/selected".
  return Number(val) !== 0;
}
