/**
 * The value-formatter registry, keyed by the spec `format` key. KPI widgets name
 * a formatter here; the cross-reference validator checks every `format` against
 * {@link formatterRegistry}.
 */

export type Formatter = (value: unknown) => string;

/** Coerce to a finite number, or null when it cannot be. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Thousands-separated integer (e.g. `2,681`). */
const number: Formatter = (value) => {
  const parsed = toNumber(value);
  return parsed === null ? '—' : parsed.toLocaleString('en-US');
};

/** Compact notation (e.g. `2.7K`). */
const compact: Formatter = (value) => {
  const parsed = toNumber(value);
  return parsed === null
    ? '—'
    : parsed.toLocaleString('en-US', { notation: 'compact' });
};

/** Plain string passthrough. */
const text: Formatter = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
};

export const formatterRegistry: Record<string, Formatter> = {
  number,
  compact,
  text,
};

/** Look up a formatter, falling back to `text` for an unknown key. */
export function getFormatter(key: string): Formatter {
  return formatterRegistry[key] ?? text;
}
