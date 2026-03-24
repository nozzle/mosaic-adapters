import { useEffect, useMemo } from 'react';
import { Selection } from '@uwdata/mosaic-core';

type SelectionType = 'intersect' | 'union' | 'single' | 'crossfilter';
type LinkedSelection = Selection & { _relay: Set<Selection> };

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

function detachIncludedSelection(source: Selection, derived: Selection) {
  const relay = (source as LinkedSelection)._relay;
  relay.delete(derived);
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
  externals: Array<Selection>,
) {
  const map = {} as Record<TKey, Selection>;
  const keys = Object.keys(inputs) as Array<TKey>;
  const inputValues: Array<Selection> = Object.values(inputs);

  keys.forEach((key) => {
    const self = inputs[key];
    const others = inputValues.filter((selection) => selection !== self);

    map[key] = Selection.intersect({
      include: [...others, ...externals],
    });
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
  const contexts = useMemo(
    () => createCascadingContextMap(inputs, externals),
    [inputs, externals],
  );

  useEffect(() => {
    return () => detachContexts(inputs, externals, contexts);
  }, [inputs, externals, contexts]);

  return contexts;
}
