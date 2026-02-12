/**
 * Context provider for the Mosaic Coordinator.
 * Allows any component or hook in the subtree to access the central coordinator instance.
 */
import { createContext, useContext } from 'react';
import type { Coordinator } from '@uwdata/mosaic-core';

export const MosaicContext = createContext<Coordinator | null>(null);

/**
 * Hook to retrieve the active Mosaic Coordinator.
 * Throws an error if used outside of a MosaicContext Provider.
 */
export function useCoordinator(): Coordinator {
  const context = useContext(MosaicContext);
  if (!context) {
    throw new Error(
      'useCoordinator must be used within a MosaicContext.Provider',
    );
  }
  return context;
}

/**
 * Hook to retrieve the active Mosaic Coordinator, or null if not yet available.
 * Does not throw — useful in components that render before the coordinator is ready.
 */
export function useOptionalCoordinator(): Coordinator | null {
  return useContext(MosaicContext);
}
