import type { Topology } from '@nozzleio/mosaic-core';
import type { Param, Selection } from '@uwdata/mosaic-core';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

const MosaicTopologyContext = createContext<Topology | null>(null);

export interface MosaicTopologyProviderProps {
  /**
   * The single topology instance to distribute (typically from `useTopology`).
   * `null` marks an explicit boundary (e.g. a subtree whose topology is still
   * loading): it shadows any outer provider, so topology hooks below it throw
   * the same "no provider" error instead of resolving a parent's topology.
   */
  topology: Topology | null;
  children?: ReactNode;
}

/**
 * Distribute one {@link Topology} instance to descendants so widgets can resolve
 * Selections by name without prop-drilling. Deliberately dumb: it holds a single
 * instance and has no registry semantics of its own — construction, validation,
 * and teardown all live on the topology object (build it with `useTopology`).
 */
export function MosaicTopologyProvider(props: MosaicTopologyProviderProps) {
  return (
    <MosaicTopologyContext.Provider value={props.topology}>
      {props.children}
    </MosaicTopologyContext.Provider>
  );
}

/**
 * Return the {@link Topology} provided by the nearest
 * {@link MosaicTopologyProvider}. Throws a clear error when used outside a
 * provider, or below one given `topology={null}` — a topology is a required
 * page-scope object, so there is no sensible default to fall back to.
 */
export function useMosaicTopology(): Topology {
  const topology = useContext(MosaicTopologyContext);
  if (topology === null) {
    throw new Error(
      '[react-mosaic] useMosaicTopology must be used within a ' +
        '<MosaicTopologyProvider> that holds a topology. Wrap the subtree in a ' +
        'provider and pass it a topology from useTopology(config, options); ' +
        'below a provider given topology={null} (an explicit boundary), gate ' +
        'the topology hooks on readiness.',
    );
  }
  return topology;
}

/**
 * Sugar over {@link useMosaicTopology}: resolve a ref through the provided
 * topology to its {@link Selection}. Throws (via `topology.resolve`) on an
 * undeclared or bare-compound ref, listing the topology's valid names — the same
 * contract as calling `resolve` directly.
 *
 * @param ref - A topology ref (`entry` or `entry.child`).
 * @returns The resolved Selection.
 */
export function useMosaicSelectionRef(ref: string): Selection {
  const topology = useMosaicTopology();
  return topology.resolve(ref);
}

/**
 * Sugar over {@link useMosaicTopology}: resolve a ref through the provided
 * topology to its {@link Param}. Throws (via `topology.resolveParam`) on an
 * undeclared ref, a dotted ref (params have no children), or a ref to a
 * selection-flavored entry — the same contract as calling `resolveParam`
 * directly.
 *
 * The `TParamValue` type parameter (default `any`) flows through to the returned
 * `Param`, so a caller can write `useMosaicParamRef<MedalMetric>('metric')`
 * instead of casting the result. It is a caller-side assertion only — the
 * topology never verifies it.
 *
 * @param ref - A bare topology param ref (`entry`).
 * @returns The resolved Param.
 */
export function useMosaicParamRef<TParamValue = any>(ref: string): Param<TParamValue> {
  const topology = useMosaicTopology();
  return topology.resolveParam<TParamValue>(ref);
}
