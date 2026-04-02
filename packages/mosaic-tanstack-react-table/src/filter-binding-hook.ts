import * as React from 'react';
import { useMosaicSelectionValue } from '@nozzleio/react-mosaic';

import {
  applyFilterSelection,
  areFilterBindingStatesEqual,
  clearFilterSelection,
  normalizeFilterBindingState,
} from './filter-builder-helpers';

import type { FilterBinding, FilterRuntime } from './filter-builder-types';

export function useFilterBinding(filter: FilterRuntime): FilterBinding {
  const selectionValue = useMosaicSelectionValue<unknown>(filter.selection);
  const syncedState = React.useMemo(
    () => normalizeFilterBindingState(filter.definition, selectionValue),
    [filter.definition, selectionValue],
  );
  const [state, setState] = React.useState(syncedState);

  React.useEffect(() => {
    setState((previousState) => {
      if (areFilterBindingStatesEqual(previousState, syncedState)) {
        return previousState;
      }

      return syncedState;
    });
  }, [syncedState]);

  const setOperator = React.useCallback((next: string) => {
    setState((previousState) => ({
      ...previousState,
      operator: next,
    }));
  }, []);

  const setValue = React.useCallback(
    (next: unknown) => {
      setState((previousState) => {
        if (
          filter.definition.valueKind === 'date-range' ||
          filter.definition.valueKind === 'number-range'
        ) {
          const nextRange = Array.isArray(next)
            ? next
            : [next, previousState.valueTo];
          return {
            ...previousState,
            value: [nextRange[0] ?? null, nextRange[1] ?? null],
            valueTo: nextRange[1] ?? null,
          };
        }

        return {
          ...previousState,
          value: next,
        };
      });
    },
    [filter.definition.valueKind],
  );

  const setValueTo = React.useCallback(
    (next: unknown) => {
      setState((previousState) => {
        if (
          filter.definition.valueKind === 'date-range' ||
          filter.definition.valueKind === 'number-range'
        ) {
          const currentRange = Array.isArray(previousState.value)
            ? previousState.value
            : [previousState.value, previousState.valueTo];

          return {
            ...previousState,
            value: [currentRange[0] ?? null, next ?? null],
            valueTo: next ?? null,
          };
        }

        return {
          ...previousState,
          valueTo: next,
        };
      });
    },
    [filter.definition.valueKind],
  );

  const clear = React.useCallback(() => {
    setState(normalizeFilterBindingState(filter.definition, null));
    clearFilterSelection(filter);
  }, [filter]);

  const apply = React.useCallback(() => {
    applyFilterSelection(filter, state);
  }, [filter, state]);

  return {
    operator: state.operator,
    value: state.value,
    valueTo: state.valueTo,
    setOperator,
    setValue,
    setValueTo,
    clear,
    apply,
  };
}
