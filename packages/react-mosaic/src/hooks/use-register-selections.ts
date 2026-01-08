/**
 * Hook to automatically register Mosaic Selections with the global registry.
 * Handles registration on mount and unregistration on unmount.
 */
import { useEffect } from 'react';
import { useSelectionRegistry } from '../selection-registry';
import type { Selection } from '@uwdata/mosaic-core';

export function useRegisterSelections(selections: Array<Selection>) {
  const { register, unregister } = useSelectionRegistry();

  useEffect(() => {
    if (selections.length === 0) {
      return;
    }

    register(selections);

    return () => {
      unregister(selections);
    };
  }, [selections, register, unregister]);
}
