import { useEffect, useMemo } from 'react';
import { Selection } from '@uwdata/mosaic-core';

import type { SelectionClause } from '@uwdata/mosaic-core';

type SelectionType = 'intersect' | 'union' | 'single' | 'crossfilter';
type LinkedSelection = Selection & { _relay: Set<Selection> };

const SELECTION_IDS = new WeakMap<Selection, number>();
let nextSelectionId = 1;

function createSelection(type: SelectionType) {
  switch (type) {
    case 'crossfilter':
      return Selection.crossfilter();
    case 'union':
      return Selection.union();
    case 'single':
      return Selection.single();
    case 'intersect':
    default:
      return Selection.intersect();
  }
}

function getSelectionId(selection: Selection) {
  const existingId = SELECTION_IDS.get(selection);
  if (existingId) {
    return existingId;
  }

  const nextId = nextSelectionId++;
  SELECTION_IDS.set(selection, nextId);
  return nextId;
}

function getSelectionListKey(selections: Array<Selection>) {
  return selections.map((selection) => getSelectionId(selection)).join('\0');
}

function detachIncludedSelection(source: Selection, derived: Selection) {
  const relay = (source as LinkedSelection)._relay;
  relay.delete(derived);
}

function attachIncludedSelection(source: Selection, derived: Selection) {
  const relay = (source as LinkedSelection)._relay;
  relay.add(derived);
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

function getContextSources(
  inputs: Record<string, Selection>,
  externals: Array<Selection>,
  key: string,
) {
  const self = inputs[key];
  const others = Object.values(inputs).filter(
    (selection) => selection !== self,
  );
  return [...others, ...externals];
}

function attachContexts(
  inputs: Record<string, Selection>,
  externals: Array<Selection>,
  contexts: Record<string, Selection>,
) {
  for (const key of Object.keys(inputs)) {
    const context = contexts[key];
    if (!context) {
      continue;
    }

    const sources = getContextSources(inputs, externals, key);
    sources.forEach((source) => {
      attachIncludedSelection(source, context);
    });
    seedContext(sources, context);
  }
}

function detachContexts(
  inputs: Record<string, Selection>,
  externals: Array<Selection>,
  contexts: Record<string, Selection>,
) {
  for (const key of Object.keys(inputs)) {
    const self = inputs[key];
    const context = contexts[key];
    if (!context) {
      continue;
    }

    for (const other of Object.values(inputs)) {
      if (other !== self) {
        detachIncludedSelection(other, context);
      }
    }

    for (const external of externals) {
      detachIncludedSelection(external, context);
    }
  }
}

function createCascadingContextMap<TKey extends string>(
  inputs: Record<TKey, Selection>,
) {
  const map = {} as Record<TKey, Selection>;
  const keys = Object.keys(inputs) as Array<TKey>;

  keys.forEach((key) => {
    map[key] = Selection.intersect();
  });

  return map;
}

/**
 * Hook to batch instantiate stable Mosaic Selections.
 * Useful for dashboards with many inputs where calling useMosaicSelection N times is verbose.
 *
 * @param keys - Static array of keys to identify the selections.
 * @param type - The resolution type for the selections (default: 'intersect').
 */
export function useMosaicSelections<TKey extends string>(
  keys: ReadonlyArray<TKey>,
  type: SelectionType = 'intersect',
): Record<TKey, Selection> {
  // Derive a stable scalar from the keys array so that callers can safely
  // pass inline array literals (e.g. `useMosaicSelections(['a','b'])`)
  // without causing Selection recreation on every render.
  const keyString = keys.join('\0');

  const selections = useMemo(() => {
    const map = {} as Record<TKey, Selection>;
    keys.forEach((key) => {
      map[key] = createSelection(type);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyString, type]);

  return selections;
}

/**
 * Hook to automatically wire "Peer Cascading" topology.
 * For every input selection provided, it creates a Context that includes:
 * 1. All OTHER input selections (excluding itself).
 * 2. All provided EXTERNAL selections.
 *
 * This pattern ensures that a filter dropdown is filtered by every other control
 * on the dashboard, but NOT by its own current value (preventing the "Ghost Option" bug).
 *
 * @param inputs - Map of input selections (from useMosaicSelections).
 * @param externals - Array of additional selections to include in every context (e.g. Table Filters).
 */
export function useCascadingContexts<TKey extends string>(
  inputs: Record<TKey, Selection>,
  externals: Array<Selection> = [],
): Record<TKey, Selection> {
  const externalsKey = getSelectionListKey(externals);
  const stableExternals = useMemo(
    () => externals,
    // The key fully captures identity/order for this selection list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [externalsKey],
  );
  const contexts = useMemo(() => createCascadingContextMap(inputs), [inputs]);

  useEffect(() => {
    attachContexts(inputs, stableExternals, contexts);

    return () => {
      detachContexts(inputs, stableExternals, contexts);

      for (const key of Object.keys(inputs)) {
        clearSeededClauses(
          getContextSources(inputs, stableExternals, key),
          contexts[key as TKey],
        );
      }
    };
  }, [contexts, inputs, stableExternals]);

  return contexts;
}

export function useComposedSelection(
  includedSelections: Array<Selection>,
): Selection {
  const includedSelectionsKey = getSelectionListKey(includedSelections);
  const stableIncludedSelections = useMemo(
    () => includedSelections,
    // The key fully captures identity/order for this selection list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [includedSelectionsKey],
  );
  const context = useMemo(() => Selection.intersect(), []);

  useEffect(() => {
    if (stableIncludedSelections.length === 0) {
      return;
    }

    stableIncludedSelections.forEach((selection) => {
      attachIncludedSelection(selection, context);
    });
    seedContext(stableIncludedSelections, context);

    return () => {
      stableIncludedSelections.forEach((selection) => {
        detachIncludedSelection(selection, context);
      });
      clearSeededClauses(stableIncludedSelections, context);
    };
  }, [context, stableIncludedSelections]);

  return context;
}
