/**
 * The single development-mode gate behind every development-only warning
 * (the dotted table-name hint and the ignored-filter warning). It is opt-in:
 * only an explicit non-production `NODE_ENV` counts as development.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

import { isDevelopment } from '../src/dev';

/**
 * Run `fn` with the global `process` replaced by `value`, or removed
 * entirely when `value` is omitted (an unbundled browser). The original
 * property descriptor is restored afterwards, so the test runner keeps its
 * own `process`.
 */
function withProcess<T>(fn: () => T, ...value: [] | [unknown]): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  if (descriptor === undefined) {
    throw new Error('expected a global `process` in the test runtime');
  }
  if (value.length === 0) {
    Reflect.deleteProperty(globalThis, 'process');
  } else {
    Object.defineProperty(globalThis, 'process', {
      configurable: true,
      writable: true,
      value: value[0],
    });
  }
  try {
    return fn();
  } finally {
    Object.defineProperty(globalThis, 'process', descriptor);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isDevelopment', () => {
  test.each(['development', 'test', 'staging'])('NODE_ENV=%s counts as development', (env) => {
    vi.stubEnv('NODE_ENV', env);
    expect(isDevelopment()).toBe(true);
  });

  test('NODE_ENV=production never counts as development', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(isDevelopment()).toBe(false);
  });

  test('an unset NODE_ENV does not count as development', () => {
    vi.stubEnv('NODE_ENV', undefined);
    expect(process.env.NODE_ENV).toBeUndefined();
    expect(isDevelopment()).toBe(false);
  });

  test('a missing `process` global does not count as development', () => {
    const result = withProcess(() => ({
      hasProcess: 'process' in globalThis,
      development: isDevelopment(),
    }));
    expect(result).toEqual({ hasProcess: false, development: false });
  });

  test('a `process` shim without `env` does not count as development', () => {
    expect(withProcess(() => isDevelopment(), {})).toBe(false);
    expect(withProcess(() => isDevelopment(), { env: {} })).toBe(false);
  });
});
