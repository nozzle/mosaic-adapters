/**
 * Context provider for the Selection Registry.
 * Maintains a set of active Mosaic Selections and provides methods to register, unregister, and reset them.
 * This registry acts as the central point for the "Global Reset" functionality.
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

// Define a stable source identity for Global Resets
// This allows clients to distinguish between "Someone cleared their filter" vs "Global Reset"
const RESET_SOURCE = { id: 'GlobalReset' };

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
      // 1. Prioritize standard .reset() method if available.
      // This wipes all clauses from all sources, ensuring a true "clean slate".
      if (
        'reset' in selection &&
        typeof (selection as any).reset === 'function'
      ) {
        (selection as any).reset();
        return;
      }

      // 2. Fallback: Force update with empty values.
      // We use RESET_SOURCE to signal to listeners that this is a global event.
      // We use predicate: undefined (instead of null) to ensure the Query Builder
      // ignores this clause, preventing "WHERE null" syntax errors in DuckDB.
      selection.update({
        source: RESET_SOURCE,
        value: null,
        // @ts-expect-error - Force undefined to ensure "No Predicate" behavior in query generation
        predicate: undefined,
      });
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
