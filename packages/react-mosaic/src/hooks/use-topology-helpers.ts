import { useMemo } from 'react';
import { Selection } from '@uwdata/mosaic-core';

/**
 * Hook to batch instantiate stable Mosaic Selections.
 * Useful for dashboards with many inputs where calling useMosaicSelection N times is verbose.
 *
 * @param keys - Static array of keys to identify the selections.
 * @param type - The resolution type for the selections (default: 'intersect').
 */
export function useMosaicSelections<TKey extends string>(
  keys: ReadonlyArray<TKey>,
  type: 'intersect' | 'union' | 'single' | 'crossfilter' = 'intersect',
): Record<TKey, Selection> {
  const selections = useMemo(() => {
    const map = {} as Record<TKey, Selection>;
    keys.forEach((key) => {
      switch (type) {
        case 'crossfilter':
          map[key] = Selection.crossfilter();
          break;
        case 'union':
          map[key] = Selection.union();
          break;
        case 'single':
          map[key] = Selection.single();
          break;
        case 'intersect':
        default:
          map[key] = Selection.intersect();
          break;
      }
    });
    return map;
  }, [keys, type]);

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
  // Create stable dependency key from input keys and external count
  // The actual Selection objects are stable (from useMosaicSelections),
  // so we only need to track when the structure changes
  const inputKeys = Object.keys(inputs).sort().join(',');
  const externalsCount = externals.length;

  const contexts = useMemo(() => {
    const map = {} as Record<TKey, Selection>;
    const keys = Object.keys(inputs) as Array<TKey>;
    const inputValues: Array<Selection> = Object.values(inputs);

    keys.forEach((key) => {
      const self = inputs[key];
      // "All inputs except me"
      const others = inputValues.filter((s) => s !== self);

      // Context = Others + Externals
      map[key] = Selection.intersect({
        include: [...others, ...externals],
      });
    });

    return map;
    // We use inputKeys + externalsCount as stable dependency proxies
    // The actual Selection instances are stable from useMosaicSelections
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, externals, inputKeys, externalsCount]);

  return contexts;
}
