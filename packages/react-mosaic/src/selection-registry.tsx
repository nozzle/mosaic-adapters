/**
 * Context provider for the Selection Registry.
 * Maintains a set of active Mosaic Selections and provides methods to register, unregister, and reset them.
 * This acts as the central point for "Global Reset" functionality.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from 'react';
import type { Selection } from '@uwdata/mosaic-core';

export interface SelectionRegistryContextType {
  register: (selections: Array<Selection>) => void;
  unregister: (selections: Array<Selection>) => void;
  resetAll: () => void;
}

const SelectionRegistryContext =
  createContext<SelectionRegistryContextType | null>(null);

export function SelectionRegistryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use a Ref for the Set to ensure stability without triggering re-renders on registration
  const registry = useRef<Set<Selection>>(new Set());

  const register = useCallback((selections: Array<Selection>) => {
    selections.forEach((s) => registry.current.add(s));
  }, []);

  const unregister = useCallback((selections: Array<Selection>) => {
    selections.forEach((s) => registry.current.delete(s));
  }, []);

  const resetAll = useCallback(() => {
    registry.current.forEach((selection) => {
      // Use standard reset() to wipe all clauses from all sources.
      // This emits an update with source=null, which MosaicFacetMenu correctly
      // interprets as a Global Reset signal (clearing search terms/internal state).
      selection.reset();
    });
  }, []);

  const value = useMemo(
    () => ({ register, unregister, resetAll }),
    [register, unregister, resetAll],
  );

  return (
    <SelectionRegistryContext.Provider value={value}>
      {children}
    </SelectionRegistryContext.Provider>
  );
}

export const useSelectionRegistry = () => {
  const context = useContext(SelectionRegistryContext);
  if (!context) {
    throw new Error(
      'useSelectionRegistry must be used within SelectionRegistryProvider',
    );
  }
  return context;
};
