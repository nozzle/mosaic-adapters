import * as React from 'react';
import { useStore } from '@tanstack/react-store';
import {
  FilterBindingController,
  applyFilterSelection,
  areFilterBindingStatesEqual,
  readFilterSelectionState,
} from '@nozzleio/mosaic-core';

import {
  createFilterBindingPersistenceContext,
  getCommittedFilterSelectionState,
  getFilterBindingStateKey,
  isRecentPersistedHydration,
  markRecentPersistedHydration,
  readCommittedFilterWriteReason,
} from './persistence-helpers';

import type { FilterBindingState, FilterRuntime } from '@nozzleio/mosaic-core';
import type { UseFilterBindingOptions } from './types';

export function useFilterBindingControllerState(
  filter: FilterRuntime,
  options?: UseFilterBindingOptions,
): {
  controller: FilterBindingController;
  state: FilterBindingState;
} {
  const persister = options?.persister;
  const filterClauseTarget = options?.filterClauseTarget ?? 'where';
  const controller = React.useMemo(
    () => new FilterBindingController(filter, { filterClauseTarget }),
    [filter, filterClauseTarget],
  );
  const bindingContext = React.useMemo(
    () => createFilterBindingPersistenceContext(filter),
    [filter],
  );
  const suppressedHydrationWriteKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    controller.connect();

    return () => {
      controller.disconnect();
    };
  }, [controller]);

  React.useEffect(() => {
    if (!persister) {
      return;
    }

    if (getCommittedFilterSelectionState(filter)) {
      return;
    }

    const persistedState = persister.read(bindingContext);

    // The binding controller hydrates synchronously only; a thenable read is
    // ignored here (async binding hydration is a later-phase concern).
    if (!persistedState || isThenable(persistedState)) {
      return;
    }

    suppressedHydrationWriteKeyRef.current =
      getFilterBindingStateKey(persistedState);
    markRecentPersistedHydration(filter.selection, persistedState);
    applyFilterSelection(filter, persistedState, filterClauseTarget);
  }, [bindingContext, filter, filterClauseTarget, persister]);

  React.useEffect(() => {
    if (!persister) {
      return;
    }

    const handleCommittedSelectionChange = () => {
      const committedState = getCommittedFilterSelectionState(filter);

      if (committedState) {
        const committedStateKey = getFilterBindingStateKey(committedState);

        if (suppressedHydrationWriteKeyRef.current === committedStateKey) {
          suppressedHydrationWriteKeyRef.current = null;
          return;
        }

        if (isRecentPersistedHydration(filter.selection, committedState)) {
          return;
        }

        persister.write(committedState, {
          ...bindingContext,
          reason: readCommittedFilterWriteReason(filter.selection),
        });
        return;
      }

      suppressedHydrationWriteKeyRef.current = null;
      persister.write(null, {
        ...bindingContext,
        reason: readCommittedFilterWriteReason(filter.selection),
      });
    };

    filter.selection.addEventListener('value', handleCommittedSelectionChange);

    return () => {
      filter.selection.removeEventListener(
        'value',
        handleCommittedSelectionChange,
      );
    };
  }, [bindingContext, filter, persister]);

  const state = useStore(controller.store, (store) => store);

  React.useEffect(() => {
    const nextState = readFilterSelectionState(filter);

    controller.store.setState((previousState) => {
      if (areFilterBindingStatesEqual(previousState, nextState)) {
        return previousState;
      }

      return nextState;
    });
  }, [controller, filter]);

  return { controller, state };
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
