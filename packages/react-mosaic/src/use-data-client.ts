import { isSameQuerySource } from '@nozzleio/mosaic-core';
import type {
  DataClient,
  DataClientMeta,
  DataClientStatus,
  QuerySource,
} from '@nozzleio/mosaic-core';
import type { Param } from '@uwdata/mosaic-core';
import { useEffect, useReducer, useRef } from 'react';

/** The `queryKey` option shared by every data-client hook. */
export interface QueryKeyOptions {
  /**
   * Re-query when the query itself changes. `query` (and `from`) are held by
   * latest-ref, so a recompiled factory is only picked up by the next
   * trigger; list here the values the factory is compiled from (pivot
   * columns, a rule set, picked columns) and a change re-queries via
   * `client.invalidate()` — coalesced with an inputs change in the same
   * render into one query, and keeping derived memos such as the rows
   * client's COUNT query (unlike `refetch()`).
   *
   * Compared element-wise with `Object.is` against the previous render (the
   * `useVgPlot` deps contract); the first render never re-queries. Omitted,
   * a new factory never re-queries on its own.
   */
  queryKey?: ReadonlyArray<unknown>;
}

/**
 * The controlled-binding engine shared by every client hook. Option handling
 * follows the round-3 identity rules:
 *
 * - **Structural identity** (`structuralKey`): any change destroys and
 *   recreates the client. Every option without a core setter is structural.
 * - **Latest-ref** (`sync`, `meta`): `query`/`coerce` and the debugging
 *   `meta` are swapped into the client on every committed render; a new
 *   identity never recreates the client and never re-queries.
 * - **Value-diffed**: `inputs` is forwarded as a controlled merge-patch
 *   (keys that disappear between renders are explicitly cleared) and deep
 *   value-diffed by the core — a re-query happens iff the value changed;
 *   `enabled` goes through `setEnabled`.
 * - **Query key** (`queryKey`, opt-in): compared element-wise by `Object.is`
 *   against the previous committed render; a change calls `invalidate()`
 *   after the inputs sync, so it coalesces with an inputs change into one
 *   query. The first render and a freshly recreated client never invalidate
 *   (their first query is built from the latest factory anyway). Omitted, it
 *   never re-queries — latest-ref semantics are unchanged.
 *
 * Clients are created lazily during render (the ref-guarded creation runs
 * once per mount, StrictMode included) but always with `enabled: false`; the
 * post-commit sync effect applies the real `enabled`, so the first query only
 * starts for committed components. A render React discards can therefore
 * leak at most a disabled, never-queried client. StrictMode's simulated
 * unmount destroys the client; the lifecycle effect detects the destroyed
 * client on remount and recreates it.
 */
export function useBoundClient<
  TInputs extends object,
  TClient extends DataClient<TInputs, any>,
>(binding: {
  /** Construct the client. Must pass `enabled: false` to the core factory. */
  create: () => TClient;
  /** Values compared by `Object.is`; any change recreates the client. */
  structuralKey: ReadonlyArray<unknown>;
  inputs: TInputs | undefined;
  enabled: boolean;
  /**
   * The hook's `queryKey` option: a change re-queries via `invalidate()`.
   * `undefined` (omitted) never re-queries.
   */
  queryKey: ReadonlyArray<unknown> | undefined;
  /**
   * The hook's `meta` option, synced through `setMeta` on every committed
   * render (latest-ref; never structural, never re-queries).
   */
  meta: DataClientMeta | undefined;
  /** Latest-ref swaps (`setQuery`, `setCoerce`); runs before input/enabled sync. */
  sync: (client: TClient) => void;
}): TClient {
  const { create, structuralKey, inputs, enabled, queryKey, meta, sync } = binding;

  const clientRef = useRef<TClient | null>(null);
  const keyRef = useRef<ReadonlyArray<unknown> | null>(null);
  const [, revive] = useReducer((n: number) => n + 1, 0);

  if (clientRef.current === null || !sameKey(keyRef.current, structuralKey)) {
    // Lazy render-phase creation; a replaced client stays live until the
    // lifecycle effect below destroys it on commit.
    clientRef.current = create();
    keyRef.current = structuralKey;
  }
  const client = clientRef.current;

  useEffect(() => {
    if (client.destroyed) {
      // StrictMode simulated remount: the cleanup below destroyed the
      // committed client; recreate it on the next render.
      clientRef.current = null;
      revive();
      return undefined;
    }
    return () => {
      client.destroy();
    };
  }, [client]);

  const lastInputsRef = useRef<TInputs | undefined>(inputs);
  // The query key last synced, and the client it was synced to.
  const lastQueryKeyRef = useRef<{
    client: TClient;
    queryKey: ReadonlyArray<unknown> | undefined;
  } | null>(null);
  useEffect(() => {
    if (client.destroyed) {
      return;
    }
    // Order matters: latest-ref swaps first so a triggered re-query is built
    // from the latest factory; `invalidate` after `setInputs` so both
    // coalesce into one query; `enabled` last so the deferred first query
    // sees current inputs.
    sync(client);
    client.setMeta(meta);
    client.setInputs(controlledInputsPatch(lastInputsRef.current, inputs));
    lastInputsRef.current = inputs;
    if (queryKeyChanged(lastQueryKeyRef.current, client, queryKey)) {
      client.invalidate();
    }
    lastQueryKeyRef.current = { client, queryKey };
    client.setEnabled(enabled);
  });

  return client;
}

/**
 * React-Query status semantics for the hooks: a hook that is enabled and has
 * not completed a query yet reports 'pending' from the first render; 'idle'
 * surfaces only while disabled. The core keeps 'idle' as its pre-first-query
 * state.
 */
export function deriveStatus(status: DataClientStatus, enabled: boolean): DataClientStatus {
  if (status === 'idle' && enabled) {
    return 'pending';
  }
  return status;
}

/**
 * The query source to hand to `setQuery`, compared by value rather than
 * identity where identity is noise: a `TableRefNode` built inline on every
 * render (`from: new TableRefNode(['main', 'events'])`) is compared by its
 * SQL string form, so the hook keeps the instance it already holds instead of
 * treating each render's node as a new source. Strings compare by value;
 * factories stay latest-ref (a new closure always replaces the old one).
 * The query source is never structural, so no comparison outcome recreates
 * the client.
 */
export function useStableQuerySource<TInputs extends object>(
  source: QuerySource<TInputs>,
): QuerySource<TInputs> {
  const sourceRef = useRef(source);
  // Render-phase ref write (latest-ref posture, as in `useBoundClient`): it is
  // idempotent by value, so a discarded or repeated render cannot diverge.
  if (!isSameQuerySource(sourceRef.current, source)) {
    sourceRef.current = source;
  }
  return sourceRef.current;
}

/** Structural-key entries for the `params` option (order-insensitive). */
export function paramsKey(params: Record<string, Param<any>> | undefined): Array<unknown> {
  if (!params) {
    return [];
  }
  const keys = Object.keys(params).sort();
  return keys.flatMap((key) => [key, params[key]]);
}

/** Structural-key entry for the `skipSources` option (order-insensitive). */
export function skipSourcesKey(skipSources: ReadonlySet<string> | undefined): string | undefined {
  if (!skipSources || skipSources.size === 0) {
    return undefined;
  }
  return [...skipSources].sort().join('\u0000');
}

/**
 * Whether `queryKey` changed since it was last synced to this same client.
 * The first sync of a client (initial render, structural recreation,
 * StrictMode revival) is never a change: that client's first query is built
 * from the latest factory. Omitted on both sides is no change; a key that
 * appears or disappears is one.
 */
function queryKeyChanged<TClient>(
  last: { client: TClient; queryKey: ReadonlyArray<unknown> | undefined } | null,
  client: TClient,
  queryKey: ReadonlyArray<unknown> | undefined,
): boolean {
  if (last === null || last.client !== client) {
    return false;
  }
  if (last.queryKey === undefined || queryKey === undefined) {
    return last.queryKey !== queryKey;
  }
  return !sameKey(last.queryKey, queryKey);
}

function sameKey(a: ReadonlyArray<unknown> | null, b: ReadonlyArray<unknown>): boolean {
  if (a === null || a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => Object.is(value, b[index]));
}

/**
 * Turn the hook's `inputs` option into a controlled merge-patch: keys present
 * on the previous render but absent now are explicitly cleared, so the option
 * fully owns the client's inputs. The core's deep value-diff treats
 * explicit-`undefined` as equal to missing, so clearing never re-queries by
 * itself.
 */
function controlledInputsPatch<TInputs extends object>(
  prev: TInputs | undefined,
  next: TInputs | undefined,
): Partial<TInputs> {
  const patch: Record<string, unknown> = {};
  if (prev) {
    for (const key of Object.keys(prev)) {
      patch[key] = undefined;
    }
  }
  if (next) {
    Object.assign(patch, next);
  }
  return patch as Partial<TInputs>;
}
