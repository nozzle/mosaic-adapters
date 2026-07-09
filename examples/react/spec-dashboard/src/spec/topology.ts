/**
 * Topology plumbing: turn the validated spec `topology:` section into the
 * arguments `useTopology` consumes.
 *
 * - The spec's topology is (after zod validation) a pure-JSON `TopologyConfig`,
 *   passed straight through {@link toTopologyConfig}.
 * - The non-serializable `TopologyOptions` — the kinds instantiated from the
 *   spec's `filter_kinds:` section — are built in code and keyed by each
 *   `filter-set` entry name ({@link buildTopologyOptions}).
 *
 * Plus the ref-resolution helpers widgets use instead of importing Selection
 * instances.
 */
import type { Selection } from '@uwdata/mosaic-core';
import type {
  FilterKind,
  FilterSet,
  Topology,
  TopologyConfig,
  TopologyOptions,
} from '@nozzleio/react-mosaic';
import type { TopologySpec } from './schema';

/** The one `filter-set` entry name the dashboard declares. */
export const FILTERS_ENTRY = 'filters';

/**
 * The spec topology IS a `TopologyConfig` once validated. This is a typed
 * pass-through — the schema guarantees the shape.
 */
export function toTopologyConfig(topology: TopologySpec): TopologyConfig {
  return topology;
}

/** Every `filter-set` entry name declared in the topology. */
export function filterSetEntryNames(topology: TopologySpec): Array<string> {
  const names: Array<string> = [];
  for (const [name, declaration] of Object.entries(topology)) {
    if (declaration.type === 'filter-set') {
      names.push(name);
    }
  }
  return names;
}

/**
 * The code-only options bag: attach the spec-instantiated kinds to every
 * `filter-set` entry (merged over the library built-ins by the set). No
 * persister — this example does not round-trip filters through the URL.
 */
export function buildTopologyOptions(
  topology: TopologySpec,
  specKinds: Record<string, FilterKind>,
): TopologyOptions {
  const filterSets: NonNullable<TopologyOptions['filterSets']> = {};
  for (const name of filterSetEntryNames(topology)) {
    filterSets[name] = { kinds: specKinds };
  }
  return { filterSets };
}

/** Resolve an optional topology ref to a Selection (undefined ref → undefined). */
export function resolveSelection(
  topology: Topology,
  ref: string | undefined,
): Selection | undefined {
  if (ref === undefined) {
    return undefined;
  }
  return topology.resolve(ref);
}

/** The primary `filters` FilterSet, or throw when the entry is missing. */
export function getPrimaryFilterSet(topology: Topology): FilterSet {
  const filterSet = topology.getFilterSet(FILTERS_ENTRY);
  if (filterSet === undefined) {
    throw new Error(
      `no FilterSet is declared for topology entry '${FILTERS_ENTRY}'.`,
    );
  }
  return filterSet;
}
