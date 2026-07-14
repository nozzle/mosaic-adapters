import { useSelector } from '@tanstack/react-store';
import { createValuesClient } from '@nozzleio/mosaic-core';
import {
  deriveStatus,
  paramsKey,
  skipSourcesKey,
  useBoundClient,
} from './use-data-client';
import { useMosaicCoordinator } from './context';
import type { Coordinator } from '@uwdata/mosaic-core';
import type {
  ValuesClient,
  ValuesClientOptions,
  ValuesClientState,
  ValuesInputs,
} from '@nozzleio/mosaic-core';

export type UseMosaicValuesOptions = Omit<
  ValuesClientOptions,
  'coordinator'
> & {
  /** Defaults to the nearest `MosaicProvider`, then the global coordinator. */
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

  const client = useBoundClient<ValuesInputs, ValuesClient<TValues>>({
    create: () =>
      createValuesClient<TValues>({ ...options, coordinator, enabled: false }),
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
      c.setQuery(options.query);
    },
  });

  const state = useSelector(client.store, (s) => s);
  return { ...state, status: deriveStatus(state.status, enabled), client };
}
