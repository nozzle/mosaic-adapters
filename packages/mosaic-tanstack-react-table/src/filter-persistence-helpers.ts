import {
  areFilterBindingStatesEqual,
  createEmptyFilterBindingState,
  readFilterSelectionState,
} from '@nozzleio/mosaic-tanstack-table-core/filter-builder';

import type {
  FilterBindingPersistenceContext,
  FilterBindingState,
  FilterPersistenceWriteReason,
  FilterRuntime,
  FilterScopePersistenceContext,
} from './filter-builder-types';
import type { Selection } from '@uwdata/mosaic-core';

type ScopeHydrationMarker = {
  source: 'binding' | 'scope';
  key: string;
  token: symbol;
};

const WRITE_REASON_BY_SELECTION = new WeakMap<
  Selection,
  {
    reason: FilterPersistenceWriteReason;
    token: symbol;
  }
>();

const RECENT_PERSISTED_HYDRATION_BY_SELECTION = new WeakMap<
  Selection,
  ScopeHydrationMarker
>();

function getStateKey(state: FilterBindingState): string {
  return JSON.stringify(state);
}

function isFilterBuilderSourceForRuntime(
  filter: FilterRuntime,
  source: unknown,
): source is { id: string } {
  if (typeof source !== 'object' || source === null || !('id' in source)) {
    return false;
  }

  return (
    source.id === `filter-builder:${filter.scopeId}:${filter.definition.id}`
  );
}

export function createFilterBindingPersistenceContext(
  filter: FilterRuntime,
): FilterBindingPersistenceContext {
  return {
    scopeId: filter.scopeId,
    filterId: filter.definition.id,
    definition: filter.definition,
    runtime: filter,
  };
}

export function createFilterScopePersistenceContext(
  filters: Record<string, FilterRuntime>,
  scopeId: string,
): FilterScopePersistenceContext {
  return {
    scopeId,
    filters,
  };
}

export function hasValidCommittedFilterSelectionState(
  filter: FilterRuntime,
): boolean {
  const activeClauses = filter.selection.clauses;

  if (
    activeClauses.some((clause) =>
      isFilterBuilderSourceForRuntime(filter, clause.source),
    )
  ) {
    return true;
  }

  if (activeClauses.length !== 1) {
    return false;
  }

  const [clause] = activeClauses;
  if (!clause || clause.value === null || clause.value === undefined) {
    return false;
  }

  return !areFilterBindingStatesEqual(
    readFilterSelectionState(filter),
    createEmptyFilterBindingState(filter.definition),
  );
}

export function getCommittedFilterSelectionState(
  filter: FilterRuntime,
): FilterBindingState | null {
  if (!hasValidCommittedFilterSelectionState(filter)) {
    return null;
  }

  return readFilterSelectionState(filter);
}

export function createSparseFilterScopeSnapshot(
  filters: Record<string, FilterRuntime>,
): Partial<Record<string, FilterBindingState>> {
  return Object.values(filters).reduce<
    Partial<Record<string, FilterBindingState>>
  >((snapshot, runtime) => {
    const state = getCommittedFilterSelectionState(runtime);

    if (state) {
      snapshot[runtime.definition.id] = state;
    }

    return snapshot;
  }, {});
}

export function markNextCommittedFilterWriteReason(
  selection: Selection,
  reason: FilterPersistenceWriteReason,
): void {
  const token = Symbol(reason);
  WRITE_REASON_BY_SELECTION.set(selection, {
    reason,
    token,
  });

  queueMicrotask(() => {
    const current = WRITE_REASON_BY_SELECTION.get(selection);

    if (current?.token === token) {
      WRITE_REASON_BY_SELECTION.delete(selection);
    }
  });
}

export function readCommittedFilterWriteReason(
  selection: Selection,
): FilterPersistenceWriteReason {
  return WRITE_REASON_BY_SELECTION.get(selection)?.reason ?? 'external';
}

export function getFilterBindingStateKey(state: FilterBindingState): string {
  return getStateKey(state);
}

export function markRecentPersistedHydration(
  selection: Selection,
  source: 'binding' | 'scope',
  state: FilterBindingState,
): void {
  const token = Symbol(`${source}-hydration`);
  RECENT_PERSISTED_HYDRATION_BY_SELECTION.set(selection, {
    source,
    key: getStateKey(state),
    token,
  });

  setTimeout(() => {
    const current = RECENT_PERSISTED_HYDRATION_BY_SELECTION.get(selection);

    if (current?.token === token) {
      RECENT_PERSISTED_HYDRATION_BY_SELECTION.delete(selection);
    }
  }, 0);
}

export function readRecentPersistedHydrationSource(
  selection: Selection,
  state: FilterBindingState,
): 'binding' | 'scope' | null {
  const hydration = RECENT_PERSISTED_HYDRATION_BY_SELECTION.get(selection);

  if (!hydration) {
    return null;
  }

  return hydration.key === getStateKey(state) ? hydration.source : null;
}
