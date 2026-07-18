/**
 * React-owned construction + URL synchronization boundary for the dashboard.
 *
 * URL state enters exclusively through the public `@/router` hooks. A topology
 * initializer consumes that hook snapshot before the new topology is returned,
 * so querying children mount against already-hydrated FilterSet state. Runtime
 * Mosaic state is then authoritative for that topology lifetime and an effect
 * writes later FilterSet changes through the hook-provided navigator.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  useFilterSetState,
  useTopology,
  useTopologyActiveClauses,
} from '@nozzleio/react-mosaic';
import {
  buildFilterUrlPatch,
  createDefaultsPersister,
  createUrlPersister,
} from '../filter-url';
import {
  buildSelectionUrlPatch,
  createSelectionWriteState,
  hydratePersistedSelections,
} from './selection-runtime';
import { createSearchPatchCommitter } from './search-patch-committer';
import { buildVariableParamOptions } from './variable-url';
import type {
  ActiveClause,
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
  const searchCommitter = useMemo(
    () => createSearchPatchCommitter(navigateSearch),
    [navigateSearch],
  );

  const initialize = useCallback(
    (topology: Topology) => {
      const binding = filterSetPersistenceBinding(compiled, topology, {
        search,
        navigateSearch,
      });
      if (binding !== null) {
        hydrateFilterSet(binding);
      }
      hydratePersistedSelections(
        topology,
        compiled.urlState.selections,
        search,
      );
    },
    [compiled, navigateSearch, search],
  );

  // Owned-variable persisters, keyed by entry, for `paramOptions`. The identity
  // of `paramOptions` is a topology-recreation key (see `useTopology`), so it is
  // memoized on `compiled` (+ the stable `searchCommitter`) ALONE: it must NOT
  // change on every URL navigation, or the whole topology would be torn down and
  // rebuilt on each filter/selection write. The persister `read` (URL → hydrate,
  // winning over the default) runs only once, at construction — which is
  // triggered by exactly this `compiled` change — so capturing the
  // construction-time `search` snapshot here is correct. `write` routes through
  // the shared `searchCommitter` (the same coalescing/replace queue filter +
  // selection writes use), so a variable change merges into one navigation
  // instead of firing its own extra tree-wide re-render mid-requery.
  const paramOptions = useMemo(
    () =>
      buildVariableParamOptions(compiled.urlState.variables, () => ({
        search,
        commit: (patch) => searchCommitter.schedule(patch, 'selection'),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `search` is excluded deliberately: see the comment above.
    [compiled, searchCommitter],
  );

  const topology = useTopology(compiled.topologyConfig, {
    ...compiled.topologyOptions,
    paramOptions,
    initialize,
  });
  const primaryFilterSet = topology.filterSets.filters;
  if (primaryFilterSet === undefined) {
    throw new Error("spec-dashboard requires a 'filters' FilterSet entry.");
  }
  const { specs } = useFilterSetState(primaryFilterSet);
  const activeClauses = useTopologyActiveClauses(topology);
  const writeGuard = useRef<{
    topology: Topology;
    specs: Array<FilterSpec>;
    activeClauses: Array<ActiveClause>;
    filterDirty: boolean;
    selections: ReturnType<typeof createSelectionWriteState>;
  } | null>(null);

  // Never replay a queued patch from a stale topology/spec. The spec-param
  // effect runs before the write effect below in the same commit.
  useLayoutEffect(() => {
    searchCommitter.cancel();
    return () => {
      searchCommitter.cancel();
    };
  }, [search.spec, searchCommitter, topology]);

  useEffect(() => {
    const previous = writeGuard.current;
    if (previous?.topology !== topology) {
      const selections = createSelectionWriteState();
      // Observe seeded valid values without echoing the initializer's URL read.
      buildSelectionUrlPatch(
        compiled.urlState.selections,
        activeClauses,
        selections,
      );
      writeGuard.current = {
        topology,
        specs,
        activeClauses,
        filterDirty: false,
        selections,
      };
      return;
    }

    const filterChanged = previous.specs !== specs;
    const selectionsChanged = previous.activeClauses !== activeClauses;
    if (!filterChanged && !selectionsChanged) {
      return;
    }

    const filterDirty = previous.filterDirty || filterChanged;
    const patch = buildSelectionUrlPatch(
      compiled.urlState.selections,
      activeClauses,
      previous.selections,
    );
    const persistConfig = compiled.urlState.filterSet.persistConfig;
    if (filterDirty && persistConfig !== null) {
      Object.assign(
        patch,
        buildFilterUrlPatch(
          compiled.urlState.filterSet.registry,
          persistConfig.prefix,
          specs.length === 0 ? null : specs,
        ),
      );
    }
    writeGuard.current = {
      topology,
      specs,
      activeClauses,
      filterDirty,
      selections: previous.selections,
    };
    if (Object.keys(patch).length === 0) {
      return;
    }
    searchCommitter.schedule(patch, filterChanged ? 'filter' : 'selection');
  }, [activeClauses, compiled, searchCommitter, specs, topology]);

  return topology;
}
