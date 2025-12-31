/**
 * React hook to instantiate and manage the lifecycle of a Mosaic Model/Session.
 * Ensures the model is treated as a singleton per component instance.
 */

import { useEffect, useState } from 'react';
import type { Coordinator } from '@uwdata/mosaic-core';
import type { MosaicLifecycle } from './mosaic-lifecycle';

export function useMosaicSession<T extends MosaicLifecycle>(
  factory: (coordinator: Coordinator) => T,
  coordinator: Coordinator,
): T {
  // 1. Lazy init the Model (Singleton behavior)
  // We use useState's lazy initializer to ensure 'factory' runs exactly once.
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
