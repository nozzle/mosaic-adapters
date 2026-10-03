import type { Param } from '@uwdata/mosaic-core';
import { useCallback, useRef, useSyncExternalStore } from 'react';

/**
 * The value type carried by a `Param<T>` — `T`. Resolves to `any` for an
 * untyped `Param<any>` (e.g. one read off `topology.params`).
 */
export type ParamValueOf<TParam> = TParam extends Param<infer TValue> ? TValue : never;

/**
 * The snapshot returned by `useMosaicParamValues`: one entry per key of the
 * `params` record, holding that Param's current `value` exactly as upstream
 * reports it (`undefined` when it has never been given one; an explicit `null`
 * stays `null`).
 */
export type UseMosaicParamValuesResult<TParams extends Record<string, Param<any>>> = {
  readonly [K in keyof TParams]: ParamValueOf<TParams[K]> | undefined;
};

/**
 * Read several Params' current values reactively in one subscription — the
 * record form of `useMosaicParamValue`. A toolbar or summary that renders a
 * handful of knobs (a metric, a grain, a threshold) reads them all at once
 * instead of calling the singular hook per Param.
 *
 * `params` must be memoized (module scope, `useMemo`, or `topology.params`) —
 * the same contract as a client's `params` / `inputs`. The subscription is
 * keyed on the record's identity, so an inline object literal re-subscribes on
 * every render.
 *
 * Each entry is the Param's `value` as-is — unlike `useMosaicParamValue`, an
 * explicit `null` is preserved rather than normalized to `undefined`, so a
 * nullable Param (`Param<T | null>`) round-trips faithfully.
 *
 * The returned snapshot is frozen and keeps its identity while every value is
 * `Object.is`-equal to the previous read, so it is safe to use as a hook
 * dependency. It re-renders when any listed Param's `value` changes.
 */
export function useMosaicParamValues<TParams extends Record<string, Param<any>>>(
  params: TParams,
): UseMosaicParamValuesResult<TParams> {
  const cacheRef = useRef<UseMosaicParamValuesResult<TParams> | null>(null);

  const subscribe = useCallback(
    (notify: () => void) => {
      // A Param listed under several keys is subscribed once.
      const unique = new Set<Param<any>>();
      for (const param of Object.values(params)) {
        if (isParamLike(param)) {
          unique.add(param);
        }
      }
      for (const param of unique) {
        param.addEventListener('value', notify);
      }
      return () => {
        for (const param of unique) {
          param.removeEventListener('value', notify);
        }
      };
    },
    [params],
  );

  const getSnapshot = useCallback(() => {
    const next = readParamValues(params, cacheRef.current);
    cacheRef.current = next;
    return next;
  }, [params]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Read every Param in the record. Returns `previous` unchanged when it has
 * exactly the same keys and every value is `Object.is`-equal (checked in place,
 * without allocating); otherwise a new frozen snapshot.
 */
function readParamValues<TParams extends Record<string, Param<any>>>(
  params: TParams,
  previous: UseMosaicParamValuesResult<TParams> | null,
): UseMosaicParamValuesResult<TParams> {
  const keys = Object.keys(params);
  if (previous !== null && isSameSnapshot(previous, params, keys)) {
    return previous;
  }

  // `Object.fromEntries` defines own data properties, so a key such as
  // `__proto__` becomes a real entry instead of hitting the prototype setter.
  const values = Object.fromEntries(keys.map((key) => [key, readEntry(params[key])]));
  return Object.freeze(values) as UseMosaicParamValuesResult<TParams>;
}

function isSameSnapshot(
  previous: Readonly<Record<string, unknown>>,
  params: Readonly<Record<string, Param<any>>>,
  keys: ReadonlyArray<string>,
): boolean {
  if (Object.keys(previous).length !== keys.length) {
    return false;
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(previous, key)) {
      return false;
    }
    if (!Object.is(previous[key], readEntry(params[key]))) {
      return false;
    }
  }
  return true;
}

/** A Param's `value` verbatim (`null` included); a non-Param reads as `undefined`. */
function readEntry(entry: unknown): unknown {
  if (!isParamLike(entry)) {
    return undefined;
  }
  return entry.value;
}

/**
 * Defensive guard for untyped callers (e.g. a spec-built record with a missing
 * entry): anything that is not a dispatching Param reads as `undefined` and is
 * not subscribed.
 *
 * Structural rather than upstream's `isParam` (an `instanceof` check): it
 * tolerates Params from a duplicated `@uwdata/mosaic-core` copy and keeps this
 * hook free of a runtime import.
 */
function isParamLike(value: unknown): value is Param<any> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<Param<any>>;
  return (
    typeof candidate.addEventListener === 'function' &&
    typeof candidate.removeEventListener === 'function'
  );
}
