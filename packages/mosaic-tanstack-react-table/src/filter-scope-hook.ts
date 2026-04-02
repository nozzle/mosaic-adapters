import * as React from 'react';
import { useRegisterSelections } from '@nozzleio/react-mosaic';
import { Selection } from '@uwdata/mosaic-core';

import type {
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
