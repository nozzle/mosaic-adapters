/**
 * Chip-value formatting for the FilterSet subsystem — ported/adapted from the
 * filter registry's `formatChipValue`. Kinds may override via
 * `FilterKind.formatValue`; otherwise {@link formatFilterValue} is used.
 */

/**
 * Formats a filter value for chip display:
 * - a two-element array where either end is numeric → `lo - hi` (a range),
 * - any other array → its elements joined with `', '`,
 * - a `Date` → `toLocaleDateString()`,
 * - any other object → `JSON.stringify`, falling back to `'[complex value]'`,
 * - everything else → `String(value)`.
 */
export function formatFilterValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toLocaleDateString();
  }
  if (Array.isArray(value)) {
    if (
      value.length === 2 &&
      (typeof value[0] === 'number' || typeof value[1] === 'number')
    ) {
      return `${formatFilterValue(value[0])} - ${formatFilterValue(value[1])}`;
    }
    return value.map((item) => formatFilterValue(item)).join(', ');
  }
  if (value !== null && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[complex value]';
    }
  }
  return String(value);
}

/**
 * Formats the two-bound range of an interval spec (`value`/`valueTo`, or a
 * `[lo, hi]` tuple) as `lo – hi`, tolerating a missing bound.
 */
export function formatRange(lo: unknown, hi: unknown): string {
  const left = lo === null || lo === undefined ? '' : formatFilterValue(lo);
  const right = hi === null || hi === undefined ? '' : formatFilterValue(hi);
  return `${left} – ${right}`.trim();
}
