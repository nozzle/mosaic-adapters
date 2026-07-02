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
    return (
      data as { toArray: () => Array<Record<string, unknown>> }
    ).toArray();
  }
  return [];
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
