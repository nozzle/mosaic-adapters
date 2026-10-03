import { createHistogramClient, isFilterSetPublishTarget } from '@nozzleio/mosaic-core';
import type {
  HistogramClient,
  HistogramClientOptions,
  HistogramClientState,
  HistogramInputs,
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
import type { QueryKeyOptions } from './use-data-client';

export type UseMosaicHistogramOptions = Omit<HistogramClientOptions, 'coordinator'> & {
  /**
   * Defaults to the nearest `MosaicProvider`, then the global coordinator (the
   * global only when there is no provider; a `coordinator={null}` provider throws).
   */
  coordinator?: Coordinator;
} & QueryKeyOptions;

export type UseMosaicHistogramResult = HistogramClientState & {
  client: HistogramClient;
};

/**
 * Controlled binding over `createHistogramClient`. Same identity rules as
 * `useMosaicRows`: everything without a core setter is structural (including
 * `scale` and the fixed `extent`, which pin bin spacing/domain), `from` is latest-ref,
 * `inputs` (step/bins) value-diffed.
 *
 * `persist` is structural (no core setter): a new persister identity is a
 * new storage location, so the client is recreated and re-hydrated. Keep the
 * persister identity stable (module scope or `useMemo`) or the client
 * recreates every render.
 */
export function useMosaicHistogram(options: UseMosaicHistogramOptions): UseMosaicHistogramResult {
  const coordinator = useMosaicCoordinator(options.coordinator);
  const enabled = options.enabled ?? true;
  const from = useStableQuerySource(options.from);

  // publish is a union: `{ as: Selection }` (Selection identity) vs a
  // FilterSetPublishTarget (`into`) — capture whichever arm is active so a
  // change in target recreates the client (same rationale as `persist`).
  const publish = options.publish;
  const publishKey = isFilterSetPublishTarget(publish)
    ? [publish.into, publish.id, publish.kind, publish.label]
    : [publish?.as];

  const client = useBoundClient<HistogramInputs, HistogramClient>({
    create: () => createHistogramClient({ ...options, coordinator, enabled: false }),
    structuralKey: [
      coordinator,
      options.filterBy,
      options.havingBy,
      skipSourcesKey(options.skipSources),
      options.inputMode,
      options.filterStable,
      options.coalesceFilterBy,
      options.column,
      options.columnPaths,
      options.scale,
      options.extent?.[0],
      options.extent?.[1],
      ...publishKey,
      options.persist,
      ...paramsKey(options.params),
    ],
    inputs: options.inputs,
    enabled,
    queryKey: options.queryKey,
    sync: (c) => {
      c.setQuery(from);
    },
  });

  const state = useSelector(client.store, (s) => s);
  return { ...state, status: deriveStatus(state.status, enabled), client };
}
