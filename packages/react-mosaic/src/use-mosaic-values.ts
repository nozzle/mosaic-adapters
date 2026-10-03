import { createValuesClient } from '@nozzleio/mosaic-core';
import type {
  ValuesClient,
  ValuesClientOptions,
  ValuesClientState,
  ValuesInputs,
} from '@nozzleio/mosaic-core';
import { useSelector } from '@tanstack/react-store';
import type { Coordinator } from '@uwdata/mosaic-core';

import { useMosaicCoordinator } from './context';
import {
  deriveStatus,
  paramsKey,
  skipSourcesKey,
  useBoundClient,
  useStableQuerySource,
} from './use-data-client';

export type UseMosaicValuesOptions = Omit<ValuesClientOptions, 'coordinator'> & {
  /**
   * Defaults to the nearest `MosaicProvider`, then the global coordinator (the
   * global only when there is no provider; a `coordinator={null}` provider throws).
   */
  coordinator?: Coordinator;
};

export type UseMosaicValuesResult<TValues extends Record<string, unknown>> =
  ValuesClientState<TValues> & {
    client: ValuesClient<TValues>;
  };

/**
 * Controlled binding over `createValuesClient`. Same identity rules as
 * `useMosaicRows`: everything without a core setter is structural, `query`
 * is latest-ref, `enabled` is value-diffed.
 */
export function useMosaicValues<TValues extends Record<string, unknown>>(
  options: UseMosaicValuesOptions,
): UseMosaicValuesResult<TValues> {
  const coordinator = useMosaicCoordinator(options.coordinator);
  const enabled = options.enabled ?? true;
  const query = useStableQuerySource(options.query);

  const client = useBoundClient<ValuesInputs, ValuesClient<TValues>>({
    create: () => createValuesClient<TValues>({ ...options, coordinator, enabled: false }),
    structuralKey: [
      coordinator,
      options.filterBy,
      options.havingBy,
      skipSourcesKey(options.skipSources),
      options.inputMode,
      options.filterStable,
      ...paramsKey(options.params),
    ],
    inputs: options.inputs,
    enabled,
    sync: (c) => {
      c.setQuery(query);
    },
  });

  const state = useSelector(client.store, (s) => s);
  return { ...state, status: deriveStatus(state.status, enabled), client };
}
