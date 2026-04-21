import * as React from 'react';
import { useStore } from '@tanstack/react-store';
import {
  FilterBindingController,
  applyFilterSelection,
  areFilterBindingStatesEqual,
  readFilterSelectionState,
} from '@nozzleio/mosaic-tanstack-table-core/filter-builder';

import {
  createFilterBindingPersistenceContext,
  getCommittedFilterSelectionState,
  getFilterBindingStateKey,
  markRecentPersistedHydration,
  readCommittedFilterWriteReason,
  readRecentPersistedHydrationSource,
} from './filter-persistence-helpers';

import type {
  FilterBindingState,
  FilterRuntime,
  UseFilterBindingOptions,
} from './filter-builder-types';

export function useFilterBindingControllerState(
  filter: FilterRuntime,
  options?: UseFilterBindingOptions,
): {
  controller: FilterBindingController;
  state: FilterBindingState;
} {
  const persister = options?.persister;
  const controller = React.useMemo(
    () => new FilterBindingController(filter),
    [filter],
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

    const currentSelectionState = getCommittedFilterSelectionState(filter);
    const recentHydrationSource =
      currentSelectionState !== null &&
      readRecentPersistedHydrationSource(
        filter.selection,
        currentSelectionState,
      );

    if (currentSelectionState && recentHydrationSource !== 'scope') {
      return;
    }

    const persistedState = persister.read(bindingContext);

    if (!persistedState) {
      return;
    }

    if (
      currentSelectionState &&
      areFilterBindingStatesEqual(currentSelectionState, persistedState)
    ) {
      return;
    }

    suppressedHydrationWriteKeyRef.current =
      getFilterBindingStateKey(persistedState);
    markRecentPersistedHydration(filter.selection, 'binding', persistedState);
    applyFilterSelection(filter, persistedState);
  }, [bindingContext, filter, persister]);

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

        if (
          readRecentPersistedHydrationSource(
            filter.selection,
            committedState,
          ) !== null
        ) {
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
