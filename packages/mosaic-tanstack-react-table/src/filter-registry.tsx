import { createContext, useContext, useEffect, useMemo } from 'react';
import { MosaicFilterRegistry } from '@nozzleio/mosaic-tanstack-table-core/filter-registry';
import { shallow, useStore } from '@tanstack/react-store';

import type { ReactNode } from 'react';
import type { Selection } from '@uwdata/mosaic-core';
import type {
  ActiveFilter,
  SelectionRegistration,
} from '@nozzleio/mosaic-tanstack-table-core/filter-registry';

const FilterContext = createContext<MosaicFilterRegistry | null>(null);

export function MosaicFilterProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => new MosaicFilterRegistry(), []);

  useEffect(() => {
    return () => registry.destroy();
  }, [registry]);

  return (
    <FilterContext.Provider value={registry}>{children}</FilterContext.Provider>
  );
}

export function useFilterRegistry() {
  const ctx = useContext(FilterContext);
  if (!ctx) {
    throw new Error(
      'useFilterRegistry must be used within MosaicFilterProvider',
    );
  }
  return ctx;
}

export function useActiveFilters(): Array<ActiveFilter> {
  const registry = useFilterRegistry();
  const state = useStore(registry.store, (store) => store, shallow);
  return state.filters;
}

export function useRegisterFilterSource(
  selection: Selection | null | undefined,
  groupId: string,
  metadata?: Partial<Omit<SelectionRegistration, 'selection' | 'groupId'>>,
) {
  const registry = useFilterRegistry();
  const memoMetadata = useMemo(() => metadata, [metadata]);

  useEffect(() => {
    if (!selection) {
      return;
    }

    const config: SelectionRegistration = {
      selection,
      groupId,
      ...memoMetadata,
    };

    registry.registerSelection(selection, config);
    return () => registry.unregisterSelection(selection);
  }, [registry, selection, groupId, memoMetadata]);
}
