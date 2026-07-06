/**
 * App-side glue over the declared page topology (see {@link page-context}).
 *
 * The page builds ONE {@link Topology} from the hoisted {@link topologyConfig} +
 * {@link topologyOptions} via {@link useTopology}, distributes it through a
 * {@link MosaicTopologyProvider}, and exposes two thin accessors widgets use
 * instead of importing Selection instances:
 *
 * - {@link usePageFilterSet} — the page FilterSet (`filters` entry).
 * - {@link usePageContexts} — the crossfilter read-contexts (`page`,
 *   `summaryFilterBy:<card>`), declared `compose` entries resolved from the
 *   topology.
 */
import { useMemo } from 'react';
import { useMosaicTopology, useTopology } from '@nozzleio/react-mosaic';
import {
  FILTERS_ENTRY,
  resolvePageContexts,
  topologyConfig,
  topologyOptions,
} from './page-context';
import type { PageContexts } from './page-context';
import type { FilterSet, Topology } from '@nozzleio/react-mosaic';

/** Build the page topology (stable object identity → one topology for the page). */
export function usePageTopology(): Topology {
  return useTopology(topologyConfig, topologyOptions);
}

/** The page FilterSet, resolved from the provided topology. */
export function usePageFilterSet(): FilterSet {
  const topology = useMosaicTopology();
  const filterSet = topology.getFilterSet(FILTERS_ENTRY);
  if (filterSet === undefined) {
    throw new Error(`no FilterSet is declared for entry '${FILTERS_ENTRY}'.`);
  }
  return filterSet;
}

/**
 * The crossfilter read-contexts, resolved from the provided topology. They are
 * declared `compose` entries wired and seeded by `createTopology`, so this is a
 * pure lookup, memoized to a stable object for the topology's lifetime.
 */
export function usePageContexts(): PageContexts {
  const topology = useMosaicTopology();
  return useMemo(() => resolvePageContexts(topology), [topology]);
}
