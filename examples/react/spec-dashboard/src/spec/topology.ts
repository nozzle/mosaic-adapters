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
import type { Param, Selection } from '@uwdata/mosaic-core';
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
 * Project the validated spec topology onto the library `TopologyConfig`. Almost
 * a pass-through, with two boundary translations:
 *
 * - it strips the app-only `persist` key from every declaration that accepts one
 *   (URL persistence is this app's spec vocabulary; the package `TopologyConfig`
 *   intentionally does not model it);
 * - it maps the spec's `variable` declaration onto the library's `param`
 *   declaration. "variable" is the spec-level name for a Mosaic Param (in this
 *   app "param" means a URL search param); `param` is the library-facing name,
 *   so the rename happens here, at the one boundary that talks to the library.
 *   `label`/`meta`/`reset` pass through like every other entry.
 */
export function toTopologyConfig(topology: TopologySpec): TopologyConfig {
  const config: TopologyConfig = {};
  for (const [name, declaration] of Object.entries(topology)) {
    if (declaration.type === 'variable') {
      const {
        type: _type,
        default: defaultValue,
        persist: _persist,
        ...rest
      } = declaration;
      config[name] = { type: 'param', default: defaultValue, ...rest };
      continue;
    }
    if ('persist' in declaration && declaration.persist !== undefined) {
      const { persist: _persist, ...rest } = declaration;
      config[name] = rest;
      continue;
    }
    config[name] = declaration;
  }
  return config;
}

/** Every `variable` entry name declared in the topology. */
export function variableEntryNames(topology: TopologySpec): Array<string> {
  const names: Array<string> = [];
  for (const [name, declaration] of Object.entries(topology)) {
    if (declaration.type === 'variable') {
      names.push(name);
    }
  }
  return names;
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

/**
 * Resolve an optional variable ref to its Mosaic Param (undefined ref →
 * undefined). Delegates to {@link Topology.resolveParam}, which throws — listing
 * `validNames` — on an unknown ref or a ref that names a selection-flavored
 * entry. The spec calls these "variables"; the library API says `param`, so this
 * helper is the ergonomic bridge widgets use instead of touching Params directly
 * (mirrors {@link resolveSelection}).
 *
 * The `TParamValue` type parameter (default `any`) flows through to the returned
 * `Param`, matching `Topology.resolveParam` — a caller can assert the value type
 * at the call site (`resolveVariable<MyValue>(...)`) instead of casting the
 * result. The default is `any` rather than `unknown` because `Param<T>` is
 * invariant, so an `unknown` default would not accept a concrete-typed Param.
 */
export function resolveVariable<TParamValue = any>(
  topology: Topology,
  ref: string | undefined,
): Param<TParamValue> | undefined {
  if (ref === undefined) {
    return undefined;
  }
  return topology.resolveParam<TParamValue>(ref);
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
