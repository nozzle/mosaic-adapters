import type { ActiveClause, Topology, TopologyActiveClausesState } from '@nozzleio/mosaic-core';
import { useSelector } from '@tanstack/react-store';

import { createStaticSource } from './static-source';
import { useMosaicTopology } from './topology-context';

const EMPTY_ACTIVE_CLAUSES_STATE: TopologyActiveClausesState = { clauses: [] };
Object.freeze(EMPTY_ACTIVE_CLAUSES_STATE.clauses);
Object.freeze(EMPTY_ACTIVE_CLAUSES_STATE);

const EMPTY_ACTIVE_CLAUSES_SOURCE = createStaticSource(EMPTY_ACTIVE_CLAUSES_STATE);

/**
 * Subscribe to a topology's annotated foreign active clauses. The topology is a
 * long-lived page-scope object (built with `useTopology` next to the page's
 * Selections); this hook is only the store subscription over
 * `topology.activeClauses`.
 *
 * Pass `null` / `undefined` while the topology is not available yet (e.g. a
 * subtree still loading): the hook then returns a stable, frozen empty array
 * and subscribes to nothing, so callers need not branch around the hook call.
 *
 * Annotation passthrough only — each clause carries its owning `entry`, `ref`,
 * `label`, and `meta`. No chip model, grouping, or label-map logic lives here;
 * those are app concerns (docs recipes / example apps).
 */
export function useTopologyActiveClauses(
  topology: Topology | null | undefined,
): Array<ActiveClause> {
  const source = topology?.activeClauses ?? EMPTY_ACTIVE_CLAUSES_SOURCE;
  return useSelector(source, (state) => state.clauses);
}

/**
 * Provider-consuming variant of {@link useTopologyActiveClauses}: subscribe to
 * the active clauses of the topology from the nearest
 * {@link MosaicTopologyProvider}. Stays thin — it only resolves the provided
 * topology, then delegates to the store subscription.
 */
export function useMosaicActiveClauses(): Array<ActiveClause> {
  const topology = useMosaicTopology();
  return useTopologyActiveClauses(topology);
}
