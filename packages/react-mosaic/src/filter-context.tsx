import { createContext, useContext, useEffect, useMemo } from 'react';
import { MosaicFilterRegistry } from '@nozzleio/mosaic-tanstack-table-core';
import { useStore } from '@tanstack/react-store';
import type { ReactNode } from 'react';
import type { Selection } from '@uwdata/mosaic-core';
import type {
  ActiveFilter,
  SelectionRegistration,
} from '@nozzleio/mosaic-tanstack-table-core';

const FilterContext = createContext<MosaicFilterRegistry | null>(null);

/**
 * Provider component for the Mosaic Filter Registry.
 * Initializes a new registry instance.
 */
export function MosaicFilterProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => new MosaicFilterRegistry(), []);

  useEffect(() => {
    return () => registry.destroy();
  }, [registry]);

  return (
    <FilterContext.Provider value={registry}>{children}</FilterContext.Provider>
  );
}

/**
 * Hook to access the Mosaic Filter Registry instance.
 */
export function useFilterRegistry() {
  const ctx = useContext(FilterContext);
  if (!ctx) {
    throw new Error(
      'useFilterRegistry must be used within MosaicFilterProvider',
    );
  }
  return ctx;
}

/**
 * Hook to subscribe to the list of active filters.
 * Returns an array of ActiveFilter objects.
 */
export function useActiveFilters(): Array<ActiveFilter> {
  const registry = useFilterRegistry();
  const state = useStore(registry.store);
  return state.filters;
}

/**
 * Hook to register a Selection with the Filter Registry.
 * Automatically handles registration and cleanup.
 *
 * @param selection - The Mosaic Selection to track
 * @param groupId - The logical group ID this selection belongs to
 * @param metadata - Optional configuration for labels and formatters
 */
export function useRegisterFilterSource(
  selection: Selection | null | undefined,
  groupId: string,
  metadata?: Partial<Omit<SelectionRegistration, 'selection' | 'groupId'>>,
) {
  // Use optional chaining/null check in case the provider is missing in some contexts
  const ctx = useContext(FilterContext);

  // Memoize metadata to prevent effect loops if inline object is passed
  // We use JSON stringify for shallow comparison of the config object
  const metadataJson = JSON.stringify(metadata);
  const memoMetadata = useMemo(() => {
    return metadata;
    // We intentionally depend on the JSON string to allow inline object usage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadataJson]);

  useEffect(() => {
    if (!ctx || !selection) {
      return;
    }

    const config: SelectionRegistration = {
      selection,
      groupId,
      ...memoMetadata,
    };

    ctx.registerSelection(selection, config);
    return () => ctx.unregisterSelection(selection);
  }, [ctx, selection, groupId, memoMetadata]);
}
