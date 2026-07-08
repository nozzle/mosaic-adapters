import { useSelector } from '@tanstack/react-store';
import { useMosaicTopology } from './topology-context';
import type { ActiveClause, Topology } from '@nozzleio/mosaic-core';

/**
 * Subscribe to a topology's annotated foreign active clauses. The topology is a
 * long-lived page-scope object (built with `useTopology` next to the page's
 * Selections); this hook is only the store subscription over
 * `topology.activeClauses`.
 *
 * Annotation passthrough only — each clause carries its owning `entry`, `ref`,
 * `label`, and `meta`. No chip model, grouping, or label-map logic lives here;
 * those are app concerns (docs recipes / example apps).
 */
export function useTopologyActiveClauses(
  topology: Topology,
): Array<ActiveClause> {
  return useSelector(topology.activeClauses, (state) => state.clauses);
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
