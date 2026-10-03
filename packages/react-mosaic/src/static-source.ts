/**
 * The minimal `get` / `subscribe` shape `useSelector` reads from — structurally
 * what `@tanstack/store`'s `Store` exposes.
 */
export interface ReadableSource<TValue> {
  get: () => TValue;
  subscribe: (listener: (value: TValue) => void) => { unsubscribe: () => void };
}

const NOOP_SUBSCRIPTION = Object.freeze({
  unsubscribe: () => {},
});

/**
 * A never-changing source over one value. Lets a subscription hook keep an
 * unconditional `useSelector` call (hooks cannot be called conditionally) when
 * its real source is absent, while still returning a referentially stable
 * snapshot. Create it once at module scope so its identity is stable too.
 */
export function createStaticSource<TValue>(value: TValue): ReadableSource<TValue> {
  return {
    get: () => value,
    subscribe: () => NOOP_SUBSCRIPTION,
  };
}
