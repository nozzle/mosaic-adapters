import * as React from 'react';
import { Selection } from '@uwdata/mosaic-core';
import { reapplyCommittedFilterSelection } from '@nozzleio/mosaic-core';

import { useComposedSelection } from '../use-topology-helpers';

import type { FilterRuntime } from '@nozzleio/mosaic-core';
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

  const getFilter = React.useCallback(
    (id: string) => runtimeMap.get(id),
    [runtimeMap],
  );

  return {
    id: options.scopeId,
    definitions: options.definitions,
    selections,
    context,
    getFilter,
  };
}
