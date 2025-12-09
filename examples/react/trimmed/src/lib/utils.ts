import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ClassValue } from 'clsx';

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
 * Format: "YYYY-MM-DDTHH:mm" (seconds optional)
 */
export function toDateTimeInputString(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (isNaN(date.getTime())) return '';

  // Get local ISO string parts
  // We manually construct to avoid timezone shifting issues with toISOString() (which is UTC)
  const pad = (n: number) => n.toString().padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());

  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

/**
 * Converts a Date object or ISO string to the format required by HTML <input type="date" />
 * Format: "YYYY-MM-DD"
 */
export function toDateInputString(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (isNaN(date.getTime())) return '';

  const pad = (n: number) => n.toString().padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());

  return `${yyyy}-${MM}-${dd}`;
}
