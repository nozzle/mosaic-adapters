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
 *   `summaryFilterBy:<card>`), wired lazily on first use.
 */
import { useMemo } from 'react';
import { useMosaicTopology, useTopology } from '@nozzleio/react-mosaic';
import {
  FILTERS_ENTRY,
  topologyConfig,
  topologyOptions,
  wirePageContexts,
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
 * The crossfilter read-contexts, resolved + wired from the provided topology.
 * `wirePageContexts` is idempotent per topology, so this is a stable object for
 * the topology's lifetime.
 */
export function usePageContexts(): PageContexts {
  const topology = useMosaicTopology();
  return useMemo(() => wirePageContexts(topology), [topology]);
}
