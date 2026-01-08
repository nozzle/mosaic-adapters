/**
 * Context provider for the Selection Registry.
 * Maintains a set of active Mosaic Selections and provides methods to register, unregister, and reset them.
 */
import React, { createContext, useContext, useRef } from 'react';
import type { Selection } from '@uwdata/mosaic-core';

interface SelectionRegistryContextType {
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

  const register = (selections: Array<Selection>) => {
    selections.forEach((s) => registry.current.add(s));
  };

  const unregister = (selections: Array<Selection>) => {
    selections.forEach((s) => registry.current.delete(s));
  };

  const resetAll = () => {
    registry.current.forEach((selection) => {
      // 1. Try standard Mosaic update to clear.
      // We explicitly set source to null so it mimics an external reset event.
      selection.update({
        source: null,
        value: null,
        predicate: null,
      });

      // 2. Check for a specific reset method on the instance if available in newer versions.
      if (
        'reset' in selection &&
        typeof (selection as any).reset === 'function'
      ) {
        (selection as any).reset();
      }
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
