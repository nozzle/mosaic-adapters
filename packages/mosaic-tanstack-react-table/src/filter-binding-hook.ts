import * as React from 'react';
import { useFilterBindingControllerState } from './filter-binding-controller-hook';
import { markNextCommittedFilterWriteReason } from './filter-persistence-helpers';

import type {
  FilterBinding,
  FilterRuntime,
  UseFilterBindingOptions,
} from './filter-builder-types';

export function useFilterBinding(
  filter: FilterRuntime,
  options?: UseFilterBindingOptions,
): FilterBinding {
  const { controller, state } = useFilterBindingControllerState(
    filter,
    options,
  );
  const apply = React.useCallback(() => {
    markNextCommittedFilterWriteReason(filter.selection, 'apply');
    controller.apply();
  }, [controller, filter.selection]);
  const clear = React.useCallback(() => {
    markNextCommittedFilterWriteReason(filter.selection, 'clear');
    controller.clear();
  }, [controller, filter.selection]);

  return React.useMemo(
    () => ({
      operator: state.operator,
      value: state.value,
      valueTo: state.valueTo,
      setOperator: controller.setOperator,
      setValue: controller.setValue,
      setValueTo: controller.setValueTo,
      clear,
      apply,
    }),
    [apply, clear, controller, state],
  );
}
