import { useEffect, useReducer, useRef } from 'react';
import type { Param } from '@uwdata/mosaic-core';
import type { DataClient, DataClientStatus } from '@nozzleio/mosaic-core';

/**
 * The controlled-binding engine shared by every client hook. Option handling
 * follows the round-3 identity rules:
 *
 * - **Structural identity** (`structuralKey`): any change destroys and
 *   recreates the client. Every option without a core setter is structural.
 * - **Latest-ref** (`sync`): `query`/`coerce` are swapped into the client on
 *   every committed render; a new function identity never recreates the
 *   client and never re-queries.
 * - **Value-diffed**: `inputs` is forwarded as a controlled merge-patch
 *   (keys that disappear between renders are explicitly cleared) and deep
 *   value-diffed by the core — a re-query happens iff the value changed;
 *   `enabled` goes through `setEnabled`.
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
  /** Latest-ref swaps (`setQuery`, `setCoerce`); runs before input/enabled sync. */
  sync: (client: TClient) => void;
}): TClient {
  const { create, structuralKey, inputs, enabled, sync } = binding;

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
  useEffect(() => {
    if (client.destroyed) {
      return;
    }
    // Order matters: latest-ref swaps first so a triggered re-query is built
    // from the latest factory; `enabled` last so the deferred first query
    // sees current inputs.
    sync(client);
    client.setInputs(controlledInputsPatch(lastInputsRef.current, inputs));
    lastInputsRef.current = inputs;
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
export function deriveStatus(
  status: DataClientStatus,
  enabled: boolean,
): DataClientStatus {
  if (status === 'idle' && enabled) {
    return 'pending';
  }
  return status;
}

/** Structural-key entries for the `params` option (order-insensitive). */
export function paramsKey(
  params: Record<string, Param<any>> | undefined,
): Array<unknown> {
  if (!params) {
    return [];
  }
  const keys = Object.keys(params).sort();
  return keys.flatMap((key) => [key, params[key]]);
}

/** Structural-key entry for the `skipSources` option (order-insensitive). */
export function skipSourcesKey(
  skipSources: ReadonlySet<string> | undefined,
): string | undefined {
  if (!skipSources || skipSources.size === 0) {
    return undefined;
  }
  return [...skipSources].sort().join('\u0000');
}

function sameKey(
  a: ReadonlyArray<unknown> | null,
  b: ReadonlyArray<unknown>,
): boolean {
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
