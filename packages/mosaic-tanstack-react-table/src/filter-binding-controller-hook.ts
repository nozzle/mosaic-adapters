import * as React from 'react';
import { useStore } from '@tanstack/react-store';
import { FilterBindingController } from '@nozzleio/mosaic-tanstack-table-core/filter-builder';

import type {
  FilterBindingState,
  FilterRuntime,
} from './filter-builder-types';

export function useFilterBindingControllerState(filter: FilterRuntime): {
  controller: FilterBindingController;
  state: FilterBindingState;
} {
  const controller = React.useMemo(
    () => new FilterBindingController(filter),
    [filter],
  );

  React.useEffect(() => {
    return () => {
      controller.dispose();
    };
  }, [controller]);

  const state = useStore(controller.store, (store) => store);

  return { controller, state };
}
