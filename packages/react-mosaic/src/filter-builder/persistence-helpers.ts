import {
  areFilterBindingStatesEqual,
  createEmptyFilterBindingState,
  readFilterSelectionState,
} from '@nozzleio/mosaic-core';

import type { FilterBindingState, FilterRuntime } from '@nozzleio/mosaic-core';
import type {
  FilterBindingPersistenceContext,
  FilterPersistenceWriteReason,
} from './types';
import type { Selection } from '@uwdata/mosaic-core';

type BindingHydrationMarker = {
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
  BindingHydrationMarker
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
  state: FilterBindingState,
): void {
  const token = Symbol('binding-hydration');
  RECENT_PERSISTED_HYDRATION_BY_SELECTION.set(selection, {
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

export function isRecentPersistedHydration(
  selection: Selection,
  state: FilterBindingState,
): boolean {
  const hydration = RECENT_PERSISTED_HYDRATION_BY_SELECTION.get(selection);

  if (!hydration) {
    return false;
  }

  return hydration.key === getStateKey(state);
}
