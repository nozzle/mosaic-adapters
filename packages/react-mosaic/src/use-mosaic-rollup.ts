import { useSelector } from '@tanstack/react-store';
import { createRollupClient } from '@nozzleio/mosaic-core';
import {
  deriveStatus,
  paramsKey,
  skipSourcesKey,
  useBoundClient,
} from './use-data-client';
import { useMosaicCoordinator } from './context';
import type { Coordinator } from '@uwdata/mosaic-core';
import type {
  RollupClient,
  RollupClientOptions,
  RollupClientState,
  RollupInputs,
} from '@nozzleio/mosaic-core';

export type UseMosaicRollupOptions<TRow> = Omit<
  RollupClientOptions<TRow>,
  'coordinator'
> & {
  /** Defaults to the nearest `MosaicProvider`, then the global coordinator. */
  coordinator?: Coordinator;
};

export type UseMosaicRollupResult<TRow> = RollupClientState<TRow> & {
  client: RollupClient<TRow>;
};

/**
 * Controlled binding over `createRollupClient`. `groupBy` is structural (it
 * defines the ROLLUP hierarchy); `query` and `coerce` are latest-ref.
 * Expansion state stays in the consumer (e.g. TanStack Table `expanded` keyed by
 * `groupPath`) — it is UI visibility, not a data operation.
 */
export function useMosaicRollup<TRow>(
  options: UseMosaicRollupOptions<TRow>,
): UseMosaicRollupResult<TRow> {
  const coordinator = useMosaicCoordinator(options.coordinator);
  const enabled = options.enabled ?? true;

  const client = useBoundClient<RollupInputs, RollupClient<TRow>>({
    create: () =>
      createRollupClient<TRow>({ ...options, coordinator, enabled: false }),
    structuralKey: [
      coordinator,
      options.filterBy,
      options.havingBy,
      skipSourcesKey(options.skipSources),
      options.inputMode,
      options.filterStable,
      options.groupBy.join('\u0000'),
      ...paramsKey(options.params),
    ],
    inputs: options.inputs,
    enabled,
    sync: (c) => {
      c.setQuery(options.query);
      c.setCoerce(options.coerce);
    },
  });

  const state = useSelector(client.store, (s) => s);
  return { ...state, status: deriveStatus(state.status, enabled), client };
}
