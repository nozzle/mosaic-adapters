import { createTopology } from '@nozzleio/mosaic-core';
import { useCompositionHandle } from './use-topology-helpers';
import type {
  Topology,
  TopologyConfig,
  TopologyOptions,
} from '@nozzleio/mosaic-core';

/** Construction-time application hook invoked before a new topology is returned. */
export type TopologyInitializer = (topology: Topology) => void;

/**
 * Options for {@link useTopology}: the core code-only bag ({@link TopologyOptions})
 * plus React lifecycle hooks.
 */
export interface UseTopologyOptions extends TopologyOptions {
  /**
   * Optional construction callback for application-owned bootstrap state.
   * Runs once for each newly-created topology, before that topology is
   * returned to the caller. Its identity is deliberately not a recreation
   * key: changing bootstrap inputs does not reset a live topology.
   */
  initialize?: TopologyInitializer;
}

// A stable per-object id so that a memoized/hoisted config (and the
// `selections`/`filterSets` fields of the options bag) yields a stable topology
// across renders, while a new object identity recreates it. Mirrors the
// `getSelectionId` scheme in use-topology-helpers.ts — identity, not structural
// equality, is the recreation contract (documented below).
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
 * Recreation is keyed on the **identities** of `config`, `options.selections`,
 * and `options.filterSets` (each treated as `0` when absent) — not on the
 * options bag itself, and not on `initialize`. A change to any of those three
 * references tears the previous topology down and builds a fresh one, but the
 * caller may rebuild the options bag inline every render (e.g.
 * `{ ...coreOptions, initialize }`) without recreating the topology. Consumers
 * should therefore memoize or hoist the config and the `selections` /
 * `filterSets` fields (module scope, `useMemo`, or a ref) so the topology stays
 * stable across re-renders — the same contract the Phase 1 composition hooks
 * document.
 *
 * @param config - The declarative topology config (a stable object reference).
 * @param options - The options bag: the code-only core fields (`selections`,
 *   `filterSets`, external instances and FilterSet kinds/persist keyed by config
 *   names) whose identities key recreation, plus an optional `initialize`
 *   callback whose identity never recreates. The bag object itself may be
 *   created inline every render.
 * @returns A live {@link Topology} instance, stable across re-renders.
 */
export function useTopology(
  config: TopologyConfig,
  options?: UseTopologyOptions,
): Topology {
  const configId = getObjectId(config);
  const selectionsId =
    options?.selections === undefined ? 0 : getObjectId(options.selections);
  const filterSetsId =
    options?.filterSets === undefined ? 0 : getObjectId(options.filterSets);
  const key = `${configId}::${selectionsId}::${filterSetsId}`;

  const handle = useCompositionHandle<Topology>(() => {
    const topology = createTopology(config, options);
    try {
      options?.initialize?.(topology);
    } catch (error) {
      topology.destroy();
      throw error;
    }
    return topology;
  }, key);

  return handle;
}
