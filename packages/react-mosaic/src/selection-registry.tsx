/**
 * Context provider for the Selection Registry.
 * Maintains a set of active Mosaic Selections and provides methods to register, unregister, and reset them.
 * This acts as the central point for "Global Reset" functionality.
 */
import { createContext, useContext, useRef, type ReactNode } from 'react';
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
  children: ReactNode;
}) {
  // Use a Ref for the Set to ensure stability without triggering re-renders on registration
  const registry = useRef<Set<Selection>>(new Set());

  const register = (selections: Array<Selection>) => {
    selections.forEach((s) => registry.current.add(s));
  };

  const unregister = (selections: Array<Selection>) => {
    selections.forEach((s) => registry.current.delete(s));
  };

  const resetAll = () => {
    registry.current.forEach((selection) => {
      // Use standard reset() to wipe all clauses from all sources.
      // This emits an update with source=null, which MosaicFacetMenu correctly
      // interprets as a Global Reset signal (clearing search terms/internal state).
      selection.reset();
    });
  };

  return (
    <SelectionRegistryContext.Provider
      value={{ register, unregister, resetAll }}
    >
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
