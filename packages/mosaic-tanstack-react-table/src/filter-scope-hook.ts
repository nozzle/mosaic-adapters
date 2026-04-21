import * as React from 'react';
import { useRegisterSelections } from '@nozzleio/react-mosaic';
import { Selection } from '@uwdata/mosaic-core';
import { applyFilterSelection } from '@nozzleio/mosaic-tanstack-table-core/filter-builder';

import {
  createFilterScopePersistenceContext,
  createSparseFilterScopeSnapshot,
  getCommittedFilterSelectionState,
  markRecentPersistedHydration,
  readCommittedFilterWriteReason,
  readRecentPersistedHydrationSource,
} from './filter-persistence-helpers';

import type {
  FilterBindingState,
  FilterRuntime,
  FilterScope,
  UseMosaicFiltersOptions,
} from './filter-builder-types';
import type { SelectionClause } from '@uwdata/mosaic-core';

type LinkedSelection = Selection & { _relay: Set<Selection> };

function attachIncludedSelection(source: Selection, derived: Selection) {
  const relay = (source as LinkedSelection)._relay;
  relay.add(derived);
}

function detachIncludedSelection(source: Selection, derived: Selection) {
  const relay = (source as LinkedSelection)._relay;
  relay.delete(derived);
}

function seedContext(includedSelections: Array<Selection>, context: Selection) {
  includedSelections.forEach((selection) => {
    selection.clauses.forEach((clause) => {
      context.update(clause);
    });
  });
}

function clearSeededClauses(
  includedSelections: Array<Selection>,
  context: Selection,
) {
  includedSelections.forEach((selection) => {
    selection.clauses.forEach((clause) => {
      context.update({
        source: clause.source,
        value: null,
        predicate: null,
      } as SelectionClause);
    });
  });
}

function useFilterScopeContext(includedSelections: Array<Selection>) {
  const context = React.useMemo(() => Selection.intersect(), []);

  React.useEffect(() => {
    if (includedSelections.length === 0) {
      return;
    }

    includedSelections.forEach((selection) => {
      attachIncludedSelection(selection, context);
    });
    seedContext(includedSelections, context);

    return () => {
      includedSelections.forEach((selection) => {
        detachIncludedSelection(selection, context);
      });
      clearSeededClauses(includedSelections, context);
    };
  }, [context, includedSelections]);

  return context;
}

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

export function useMosaicFilters(
  options: UseMosaicFiltersOptions,
): FilterScope & {
  getFilter: (id: string) => FilterRuntime | undefined;
} {
  const scopePersister = options.persister;
  const [selectionRecord, setSelectionRecord] = React.useState(() =>
    createSelectionRecord(options.definitions),
  );
  const nextSelections = React.useMemo(
    () => reconcileSelectionRecord(selectionRecord, options.definitions),
    [options.definitions, selectionRecord],
  );
  const selections = React.useMemo(() => {
    if (areSelectionRecordsEqual(selectionRecord, nextSelections)) {
      return selectionRecord;
    }

    return nextSelections;
  }, [nextSelections, selectionRecord]);

  React.useEffect(() => {
    if (selectionRecord === selections) {
      return;
    }

    setSelectionRecord(selections);
  }, [selectionRecord, selections]);

  const selectionList = React.useMemo(
    () => Object.values(selections),
    [selections],
  );

  useRegisterSelections(selectionList);

  const context = useFilterScopeContext(selectionList);

  const runtimes = React.useMemo(() => {
    return options.definitions.map<FilterRuntime>((definition) => ({
      definition,
      selection: selections[definition.id]!,
      scopeId: options.scopeId,
    }));
  }, [options.definitions, options.scopeId, selections]);

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

      runtime.selection.addEventListener('value', handleCommittedSelectionChange);

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
