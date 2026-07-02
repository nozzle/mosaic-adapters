import * as React from 'react';
import { Selection } from '@uwdata/mosaic-core';
import {
  applyFilterSelection,
  reapplyCommittedFilterSelection,
} from '@nozzleio/mosaic-core';

import { useComposedSelection } from '../use-topology-helpers';
import {
  createFilterScopePersistenceContext,
  createSparseFilterScopeSnapshot,
  getCommittedFilterSelectionState,
  markRecentPersistedHydration,
  readCommittedFilterWriteReason,
  readRecentPersistedHydrationSource,
} from './persistence-helpers';

import type { FilterBindingState, FilterRuntime } from '@nozzleio/mosaic-core';
import type { FilterScope, UseMosaicFiltersOptions } from './types';

function createSelectionRecord(
  definitions: UseMosaicFiltersOptions['definitions'],
) {
  return definitions.reduce<Record<string, Selection>>((record, definition) => {
    record[definition.id] = Selection.intersect();
    return record;
  }, {});
}

function reconcileSelectionRecord(
  previousSelections: Record<string, Selection>,
  definitions: UseMosaicFiltersOptions['definitions'],
) {
  return definitions.reduce<Record<string, Selection>>((record, definition) => {
    record[definition.id] =
      previousSelections[definition.id] ?? Selection.intersect();
    return record;
  }, {});
}

function areSelectionRecordsEqual(
  previousSelections: Record<string, Selection>,
  nextSelections: Record<string, Selection>,
) {
  const previousKeys = Object.keys(previousSelections);
  const nextKeys = Object.keys(nextSelections);

  if (previousKeys.length !== nextKeys.length) {
    return false;
  }

  return previousKeys.every(
    (key) => previousSelections[key] === nextSelections[key],
  );
}

/**
 * A filter scope: one Selection per definition, plus a composed `context`
 * Selection that is the AND of every filter in the scope — the thing data
 * clients take as `filterBy`/`havingBy`.
 */
export function useMosaicFilters(
  options: UseMosaicFiltersOptions,
): FilterScope & {
  getFilter: (id: string) => FilterRuntime | undefined;
} {
  const scopePersister = options.persister;
  const [selectionRecord, setSelectionRecord] = React.useState(() =>
    createSelectionRecord(options.definitions),
  );
  const nextSelections = reconcileSelectionRecord(
    selectionRecord,
    options.definitions,
  );
  const selections = areSelectionRecordsEqual(selectionRecord, nextSelections)
    ? selectionRecord
    : nextSelections;
  if (selections !== selectionRecord) {
    // Render-phase derived-state adjustment (the React-docs alternative to
    // syncing in an effect): definitions changed, so commit the reconciled
    // record — existing Selections keep their identity, new ids get fresh
    // ones.
    setSelectionRecord(selections);
  }

  const selectionList = React.useMemo(
    () => Object.values(selections),
    [selections],
  );

  const context = useComposedSelection(selectionList);

  const runtimes = React.useMemo(() => {
    return options.definitions.map<FilterRuntime>((definition) => ({
      definition,
      selection: selections[definition.id]!,
      scopeId: options.scopeId,
      // Subquery factories receive sibling-filter context from the scope
      // context; the filter's own clauses are excluded during resolution.
      ...(definition.subquery ? { context } : {}),
    }));
  }, [context, options.definitions, options.scopeId, selections]);

  // Rebuild committed subquery predicates when sibling filters change, even
  // when no filter editor (binding controller) is mounted. The reapply
  // no-ops when the rebuilt predicate is unchanged, so converged states
  // publish nothing and feedback loops terminate.
  React.useEffect(() => {
    const cleanups = runtimes
      .filter((runtime) => runtime.definition.subquery && runtime.context)
      .map((runtime) => {
        const scopeContext = runtime.context!;
        const listener = () => {
          reapplyCommittedFilterSelection(runtime);
        };

        scopeContext.addEventListener('value', listener);
        return () => {
          scopeContext.removeEventListener('value', listener);
        };
      });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [runtimes]);

  const runtimeMap = React.useMemo(() => {
    return new Map(runtimes.map((runtime) => [runtime.definition.id, runtime]));
  }, [runtimes]);
  const runtimeRecord = React.useMemo(
    () =>
      runtimes.reduce<Record<string, FilterRuntime>>((record, runtime) => {
        record[runtime.definition.id] = runtime;
        return record;
      }, {}),
    [runtimes],
  );
  const scopePersistenceContext = React.useMemo(
    () => createFilterScopePersistenceContext(runtimeRecord, options.scopeId),
    [options.scopeId, runtimeRecord],
  );
  const scopePersistenceContextRef = React.useRef(scopePersistenceContext);
  const persistedScopeSnapshotRef = React.useRef<Partial<
    Record<string, FilterBindingState>
  > | null>(null);
  const initializedScopeFiltersRef = React.useRef<Set<string>>(new Set());

  const getFilter = React.useCallback(
    (id: string) => runtimeMap.get(id),
    [runtimeMap],
  );

  React.useEffect(() => {
    scopePersistenceContextRef.current = scopePersistenceContext;
  }, [scopePersistenceContext]);

  React.useEffect(() => {
    initializedScopeFiltersRef.current = new Set();

    if (!scopePersister) {
      persistedScopeSnapshotRef.current = null;
      return;
    }

    persistedScopeSnapshotRef.current =
      scopePersister.read(scopePersistenceContextRef.current) ?? null;
  }, [options.scopeId, scopePersister]);

  React.useEffect(() => {
    if (!scopePersister) {
      return;
    }

    const persistedScopeSnapshot = persistedScopeSnapshotRef.current;

    if (!persistedScopeSnapshot) {
      return;
    }

    runtimes.forEach((runtime) => {
      const filterId = runtime.definition.id;

      if (initializedScopeFiltersRef.current.has(filterId)) {
        return;
      }

      initializedScopeFiltersRef.current.add(filterId);

      const persistedState = persistedScopeSnapshot[filterId];

      if (!persistedState || getCommittedFilterSelectionState(runtime)) {
        return;
      }

      markRecentPersistedHydration(runtime.selection, 'scope', persistedState);
      applyFilterSelection(runtime, persistedState);
    });
  }, [runtimes, scopePersister]);

  React.useEffect(() => {
    if (!scopePersister) {
      return;
    }

    const removeListeners = Object.values(runtimeRecord).map((runtime) => {
      const handleCommittedSelectionChange = () => {
        const committedState = getCommittedFilterSelectionState(runtime);

        if (
          committedState &&
          readRecentPersistedHydrationSource(
            runtime.selection,
            committedState,
          ) !== null
        ) {
          return;
        }

        scopePersister.write(createSparseFilterScopeSnapshot(runtimeRecord), {
          ...scopePersistenceContext,
          filterId: runtime.definition.id,
          definition: runtime.definition,
          runtime,
          reason: readCommittedFilterWriteReason(runtime.selection),
        });
      };

      runtime.selection.addEventListener(
        'value',
        handleCommittedSelectionChange,
      );

      return () => {
        runtime.selection.removeEventListener(
          'value',
          handleCommittedSelectionChange,
        );
      };
    });

    return () => {
      removeListeners.forEach((removeListener) => {
        removeListener();
      });
    };
  }, [runtimeRecord, scopePersistenceContext, scopePersister]);

  return {
    id: options.scopeId,
    definitions: options.definitions,
    selections,
    context,
    getFilter,
  };
}
