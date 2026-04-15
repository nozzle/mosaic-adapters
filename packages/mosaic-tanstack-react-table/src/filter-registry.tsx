import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
} from 'react';
import { MosaicFilterRegistry } from '@nozzleio/mosaic-tanstack-table-core/filter-registry';
import { useStore } from '@tanstack/react-store';

import type { ReactNode } from 'react';
import type { Selection } from '@uwdata/mosaic-core';
import type {
  ActiveFilter,
  FilterGroupConfig,
  SelectionRegistration,
} from '@nozzleio/mosaic-tanstack-table-core/filter-registry';

export type { ActiveFilter, FilterGroupConfig, SelectionRegistration };

export type RegisterFilterSourceOptions = Partial<
  Omit<SelectionRegistration, 'selection' | 'groupId'>
>;

export interface FilterRegistryApi {
  registerGroup: (config: FilterGroupConfig) => void;
  removeFilter: (filter: ActiveFilter) => void;
  clearGroup: (groupId: string) => void;
}

function areRecordValuesEqual<TValue>(
  previous: Record<string, TValue> | undefined,
  next: Record<string, TValue> | undefined,
) {
  if (previous === next) {
    return true;
  }

  if (!previous || !next) {
    return false;
  }

  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);

  if (previousKeys.length !== nextKeys.length) {
    return false;
  }

  return previousKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(next, key) &&
      previous[key] === next[key],
  );
}

function areRegisterFilterSourceOptionsEqual(
  previous: RegisterFilterSourceOptions | undefined,
  next: RegisterFilterSourceOptions | undefined,
) {
  if (previous === next) {
    return true;
  }

  if (!previous || !next) {
    return false;
  }

  return (
    areRecordValuesEqual(previous.labelMap, next.labelMap) &&
    areRecordValuesEqual(previous.formatterMap, next.formatterMap) &&
    previous.explodeArrayValues === next.explodeArrayValues
  );
}

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

  return useMemo<FilterRegistryApi>(
    () => ({
      registerGroup: (config) => ctx.registerGroup(config),
      removeFilter: (filter) => ctx.removeFilter(filter),
      clearGroup: (groupId) => ctx.clearGroup(groupId),
    }),
    [ctx],
  );
}

export function useActiveFilters(): Array<ActiveFilter> {
  const ctx = useContext(FilterContext);
  if (!ctx) {
    throw new Error(
      'useActiveFilters must be used within MosaicFilterProvider',
    );
  }

  return useStore(ctx.store, (store) => store.filters);
}

export function useRegisterFilterSource(
  selection: Selection | null | undefined,
  groupId: string,
  metadata?: RegisterFilterSourceOptions,
) {
  const ctx = useContext(FilterContext);
  if (!ctx) {
    throw new Error(
      'useRegisterFilterSource must be used within MosaicFilterProvider',
    );
  }

  const lastRegistration = useRef<{
    selection: Selection;
    groupId: string;
    metadata?: RegisterFilterSourceOptions;
  } | null>(null);
  const getMetadata = useEffectEvent(() => metadata);

  useEffect(() => {
    if (!selection) {
      return;
    }

    const resolvedMetadata = getMetadata();
    const config: SelectionRegistration = {
      selection,
      groupId,
      ...resolvedMetadata,
    };

    ctx.registerSelection(selection, config);
    lastRegistration.current = {
      selection,
      groupId,
      metadata: resolvedMetadata,
    };

    return () => {
      ctx.unregisterSelection(selection);
      if (lastRegistration.current?.selection === selection) {
        lastRegistration.current = null;
      }
    };
  }, [ctx, groupId, selection]);

  useEffect(() => {
    if (!selection) {
      return;
    }

    const previous = lastRegistration.current;
    const metadataChanged =
      !previous ||
      previous.selection !== selection ||
      previous.groupId !== groupId ||
      !areRegisterFilterSourceOptionsEqual(previous.metadata, metadata);

    if (!metadataChanged) {
      return;
    }

    ctx.registerSelection(selection, {
      selection,
      groupId,
      ...metadata,
    });

    lastRegistration.current = {
      selection,
      groupId,
      metadata,
    };
  }, [ctx, groupId, metadata, selection]);
}
