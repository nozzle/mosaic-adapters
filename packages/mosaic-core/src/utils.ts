import type { CoerceDescriptor, CoerceOption } from './types';

/**
 * Value equality for the plain-JSON shapes that client inputs are made of
 * (primitives, arrays, plain objects, Dates). Keys explicitly set to
 * `undefined` compare equal to missing keys, matching merge-patch semantics.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) {
      return false;
    }
    return a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return false;
    }
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!deepEqual(a[key], b[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Normalize a coordinator query result to row objects. Results are Arrow
 * tables by default (anything exposing `toArray()`), or already-materialized
 * arrays for JSON-typed connectors.
 */
export function toResultRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data as Array<Record<string, unknown>>;
  }
  if (
    data !== null &&
    typeof data === 'object' &&
    'toArray' in data &&
    typeof data.toArray === 'function'
  ) {
    return (data as { toArray: () => Array<Record<string, unknown>> }).toArray();
  }
  return [];
}

/**
 * The first row of a coordinator query result, or `undefined` when it has
 * none. Arrow tables are read with `.get(0)`, so a large result is never
 * materialized just to read its first row; arrays return `[0]`.
 */
export function firstResultRow(data: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(data)) {
    return toRowObject(data[0]);
  }
  if (data === null || typeof data !== 'object') {
    return undefined;
  }
  if ('get' in data && typeof data.get === 'function') {
    if (resultRowCount(data) < 1) {
      return undefined;
    }
    return toRowObject((data as { get: (index: number) => unknown }).get(0));
  }
  return toResultRows(data)[0];
}

/**
 * The number of rows in a coordinator query result: an Arrow table's
 * `numRows`, an array's `length`, else 0. Reads the count without
 * materializing rows when `numRows`/`length` is available; a result that only
 * exposes `toArray()` is materialized to count it.
 */
export function resultRowCount(data: unknown): number {
  if (Array.isArray(data)) {
    return data.length;
  }
  if (data === null || typeof data !== 'object') {
    return 0;
  }
  if ('numRows' in data && typeof data.numRows === 'number') {
    return data.numRows;
  }
  if ('length' in data && typeof data.length === 'number') {
    return data.length;
  }
  return toResultRows(data).length;
}

function toRowObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/**
 * Resolve the `coerce` option to a row mapper: closures pass through
 * (latest-ref semantics preserved by the caller), descriptor maps compile to
 * a mapper applying per-column coercions. Null/undefined values stay null.
 */
export function resolveCoerce<TRow>(
  coerce: CoerceOption<TRow> | undefined,
): ((raw: Record<string, unknown>) => TRow) | undefined {
  if (coerce === undefined || typeof coerce === 'function') {
    return coerce;
  }
  const entries = Object.entries(coerce);
  return (raw) => {
    const row: Record<string, unknown> = { ...raw };
    for (const [key, kind] of entries) {
      row[key] = coerceValue(row[key], kind);
    }
    return row as TRow;
  };
}

function coerceValue(value: unknown, kind: CoerceDescriptor): unknown {
  if (value == null) {
    return null;
  }
  switch (kind) {
    case 'date': {
      if (value instanceof Date) {
        return value;
      }
      if (typeof value === 'bigint') {
        // Parquet/DuckDB TIMESTAMP columns surface as epoch bigints. Anything
        // past ~year 2286 in ms is almost certainly microseconds (or finer),
        // so scale it down before constructing the Date.
        if (value > 10_000_000_000_000n) {
          return new Date(Number(value / 1000n));
        }
        return new Date(Number(value));
      }
      return new Date(value as string | number);
    }
    case 'number':
      return Number(value);
    case 'string':
      return String(value);
    case 'boolean':
      return Boolean(value);
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export interface TrailingThrottle<TArgs extends Array<unknown>> {
  (...args: TArgs): void;
  cancel: () => void;
}

/**
 * Leading + trailing throttle: the first call in a window fires
 * immediately, later calls collapse into one trailing invocation with the
 * latest arguments. `ms: 0` invokes synchronously.
 */
export function trailingThrottle<TArgs extends Array<unknown>>(
  fn: (...args: TArgs) => void,
  ms: number,
): TrailingThrottle<TArgs> {
  if (ms <= 0) {
    const direct = (...args: TArgs) => {
      fn(...args);
    };
    direct.cancel = () => {};
    return direct;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let trailing: { args: TArgs } | null = null;

  const throttled = (...args: TArgs) => {
    if (timer !== null) {
      trailing = { args };
      return;
    }
    fn(...args);
    timer = setTimeout(() => {
      timer = null;
      if (trailing === null) {
        return;
      }
      const { args: trailingArgs } = trailing;
      trailing = null;
      throttled(...trailingArgs);
    }, ms);
  };

  throttled.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    trailing = null;
  };

  return throttled;
}
