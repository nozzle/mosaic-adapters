/**
 * React hook to instantiate and manage the lifecycle of a MosaicViewModel.
 * Ensures the model is treated as a singleton per component instance.
 */

import { useEffect, useState } from 'react';
import type { MosaicViewModel } from '@nozzleio/mosaic-tanstack-table-core';
import type { Coordinator } from '@uwdata/mosaic-core';

export function useMosaicViewModel<T extends MosaicViewModel>(
  factory: (coordinator: Coordinator) => T,
  coordinator: Coordinator,
): T {
  // 1. Lazy init the ViewModel (Singleton behavior)
  const [model] = useState(() => factory(coordinator));

  // 2. Handle Lifecycle
  useEffect(() => {
    // Update coordinator ref if it changes
    model.setCoordinator(coordinator);

    // Connect topology
    const cleanup = model.connect();

    return () => {
      cleanup();
    };
  }, [model, coordinator]);

  return model;
}
