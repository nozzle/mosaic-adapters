/**
 * Hook to create a stable Mosaic Selection instance.
 * Selections are the reactive primitives that drive filtering logic.
 */
import { useMemo } from 'react';
import { Selection } from '@uwdata/mosaic-core';

type SelectionType = 'intersect' | 'union' | 'single' | 'crossfilter';

export function useMosaicSelection(type: SelectionType = 'intersect') {
  // We use useMemo to ensure the selection instance is stable across renders.
  // This allows it to be used as a dependency in other hooks (like table definitions)
  // without causing infinite re-renders.
  const selection = useMemo(() => {
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
  }, [type]);

  return selection;
}
