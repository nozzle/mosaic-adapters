import { useStore } from '@tanstack/react-store';
import { createHistogramClient } from '@nozzleio/mosaic-core';
import { deriveStatus, paramsKey, useBoundClient } from './use-data-client';
import { useMosaicCoordinator } from './context';
import type { Coordinator } from '@uwdata/mosaic-core';
import type {
  HistogramClient,
  HistogramClientOptions,
  HistogramClientState,
  HistogramInputs,
} from '@nozzleio/mosaic-core';

export type UseMosaicHistogramOptions = Omit<
  HistogramClientOptions,
  'coordinator'
> & {
  /** Defaults to the nearest `MosaicProvider`, then the global coordinator. */
  coordinator?: Coordinator;
};

export type UseMosaicHistogramResult = HistogramClientState & {
  client: HistogramClient;
};

/**
 * Controlled binding over `createHistogramClient`. Same identity rules as
 * `useMosaicRows`: everything without a core setter is structural (including
 * the fixed `extent`, which pins the bin domain), `from` is latest-ref,
 * `inputs` (step/bins) value-diffed.
 */
export function useMosaicHistogram(
  options: UseMosaicHistogramOptions,
): UseMosaicHistogramResult {
  const coordinator = useMosaicCoordinator(options.coordinator);
  const enabled = options.enabled ?? true;

  const client = useBoundClient<HistogramInputs, HistogramClient>({
    create: () =>
      createHistogramClient({ ...options, coordinator, enabled: false }),
    structuralKey: [
      coordinator,
      options.filterBy,
      options.havingBy,
      options.inputMode,
      options.filterStable,
      options.column,
      options.extent?.[0],
      options.extent?.[1],
      options.publish?.as,
      ...paramsKey(options.params),
    ],
    inputs: options.inputs,
    enabled,
    sync: (c) => {
      c.setQuery(options.from);
    },
  });

  const state = useStore(client.store, (s) => s);
  return { ...state, status: deriveStatus(state.status, enabled), client };
}
