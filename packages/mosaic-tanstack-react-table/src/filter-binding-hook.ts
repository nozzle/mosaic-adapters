import * as React from 'react';
import { useFilterBindingControllerState } from './filter-binding-controller-hook';

import type { FilterBinding, FilterRuntime } from './filter-builder-types';

export function useFilterBinding(filter: FilterRuntime): FilterBinding {
  const { controller, state } = useFilterBindingControllerState(filter);

  return React.useMemo(
    () => ({
      operator: state.operator,
      value: state.value,
      valueTo: state.valueTo,
      setOperator: controller.setOperator,
      setValue: controller.setValue,
      setValueTo: controller.setValueTo,
      clear: controller.clear,
      apply: controller.apply,
    }),
    [controller, state],
  );
}
