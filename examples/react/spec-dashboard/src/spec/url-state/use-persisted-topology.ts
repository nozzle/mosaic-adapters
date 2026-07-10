/**
 * React-owned construction + URL synchronization boundary for the dashboard.
 *
 * URL state enters exclusively through the public `@/router` hooks. A topology
 * initializer consumes that hook snapshot before the new topology is returned,
 * so querying children mount against already-hydrated FilterSet state. Runtime
 * Mosaic state is then authoritative for that topology lifetime and an effect
 * writes later FilterSet changes through the hook-provided navigator.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useFilterSetState, useTopology } from '@nozzleio/react-mosaic';
import { createDefaultsPersister, createUrlPersister } from '../filter-url';
import type {
  FilterSet,
  FilterSpec,
  Persister,
  Topology,
} from '@nozzleio/react-mosaic';
import type { CompiledSpec } from '../compile';
import type { PersisterIo } from '../filter-url';
import { useNavigateSearch, useSearch } from '@/router';

interface FilterSetPersistenceBinding {
  filterSet: FilterSet;
  persister: Persister<Array<FilterSpec>>;
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

/** Resolve the app-side FilterSet persister declared by the compiled spec. */
function filterSetPersistenceBinding(
  compiled: CompiledSpec,
  topology: Topology,
  io: PersisterIo,
): FilterSetPersistenceBinding | null {
  const { registry, persistConfig, defaults } = compiled.urlState.filterSet;
  if (persistConfig !== null) {
    const filterSet = topology.getFilterSet(persistConfig.entryName);
    if (filterSet === undefined) {
      return null;
    }
    return {
      filterSet,
      persister: createUrlPersister(
        registry,
        persistConfig.prefix,
        defaults,
        io,
      ),
    };
  }
  if (defaults.length === 0) {
    return null;
  }
  const firstEntry = Object.keys(topology.filterSets)[0];
  const filterSet =
    firstEntry === undefined ? undefined : topology.getFilterSet(firstEntry);
  return filterSet === undefined
    ? null
    : { filterSet, persister: createDefaultsPersister(defaults) };
}

/** Apply the synchronous URL/default bootstrap read to a newly-built FilterSet. */
function hydrateFilterSet(binding: FilterSetPersistenceBinding): void {
  const result = binding.persister.read(undefined);
  if (isThenable(result)) {
    throw new Error(
      'spec-dashboard URL persistence must hydrate synchronously before widgets mount.',
    );
  }
  for (const spec of result ?? []) {
    binding.filterSet.set(spec);
  }
}

/** Build one topology from the current hook snapshot and sync later set changes. */
export function usePersistedTopology(compiled: CompiledSpec): Topology {
  const search = useSearch();
  const navigateSearch = useNavigateSearch();

  const initialize = useCallback(
    (topology: Topology) => {
      const binding = filterSetPersistenceBinding(compiled, topology, {
        search,
        navigateSearch,
      });
      if (binding !== null) {
        hydrateFilterSet(binding);
      }
    },
    [compiled, navigateSearch, search],
  );

  const topology = useTopology(compiled.topologyConfig, {
    ...compiled.topologyOptions,
    initialize,
  });
  const primaryFilterSet = topology.filterSets.filters;
  if (primaryFilterSet === undefined) {
    throw new Error("spec-dashboard requires a 'filters' FilterSet entry.");
  }
  const { specs } = useFilterSetState(primaryFilterSet);
  const writeGuard = useRef<{
    topology: Topology;
    specs: Array<FilterSpec>;
  } | null>(null);

  useEffect(() => {
    // The initializer has already replayed URL/default state. Suppress that
    // hydration echo (including StrictMode's setup replay), then persist only a
    // new store snapshot produced by a subsequent runtime change.
    if (
      writeGuard.current?.topology !== topology ||
      writeGuard.current.specs === specs
    ) {
      writeGuard.current = { topology, specs };
      return;
    }
    writeGuard.current = { topology, specs };
    const persistConfig = compiled.urlState.filterSet.persistConfig;
    if (persistConfig === null) {
      return;
    }
    const persister = createUrlPersister(
      compiled.urlState.filterSet.registry,
      persistConfig.prefix,
      compiled.urlState.filterSet.defaults,
      { search: {}, navigateSearch },
    );
    persister.write(specs.length === 0 ? null : specs, {
      reason: specs.length === 0 ? 'clear' : 'update',
    });
  }, [compiled, navigateSearch, specs, topology]);

  return topology;
}
