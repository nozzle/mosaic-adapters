import { createTopology } from '@nozzleio/mosaic-core';
import { useCompositionHandle } from './use-topology-helpers';
import type {
  Topology,
  TopologyConfig,
  TopologyOptions,
} from '@nozzleio/mosaic-core';

// A stable per-object id so that a memoized/hoisted config (and options bag)
// yields a stable topology across renders, while a new object identity recreates
// it. Mirrors the `getSelectionId` scheme in use-topology-helpers.ts — identity,
// not structural equality, is the recreation contract (documented below).
const OBJECT_IDS = new WeakMap<object, number>();
let nextObjectId = 1;

function getObjectId(value: object): number {
  const existing = OBJECT_IDS.get(value);
  if (existing !== undefined) {
    return existing;
  }
  const id = nextObjectId++;
  OBJECT_IDS.set(value, id);
  return id;
}

/**
 * Own the lifecycle of a {@link createTopology} instance inside React: lazy
 * construction, teardown on unmount, and StrictMode-safe single-wiring (the
 * shared {@link useCompositionHandle} pattern from Phase 1 — construction is a
 * side effect that must run once per real mount, a commit-time cleanup destroys
 * it, and a simulated StrictMode remount is detected via the handle's
 * `destroyed` flag and recreated).
 *
 * Recreation is keyed on the **identity** of `config` and `options`, not their
 * structural contents: a change to either object reference tears the previous
 * topology down and builds a fresh one. Consumers should therefore memoize or
 * hoist the config and options bag (module scope, `useMemo`, or a ref) so the
 * topology stays stable across re-renders — the same contract the Phase 1
 * composition hooks document.
 *
 * @param config - The declarative topology config (a stable object reference).
 * @param options - The code-only options bag (external instances, FilterSet
 *   kinds/persist), keyed by config names. A stable object reference.
 * @returns A live {@link Topology} instance, stable across re-renders.
 */
export function useTopology(
  config: TopologyConfig,
  options?: TopologyOptions,
): Topology {
  const configId = getObjectId(config);
  const optionsId = options === undefined ? 0 : getObjectId(options);
  const key = `${configId}::${optionsId}`;

  const handle = useCompositionHandle<Topology>(
    () => createTopology(config, options),
    key,
  );

  return handle;
}
