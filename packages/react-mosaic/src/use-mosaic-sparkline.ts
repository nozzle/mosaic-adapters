import { createSparklineClient } from '@nozzleio/mosaic-core';
import type {
  SparklineClient,
  SparklineClientOptions,
  SparklineClientState,
  SparklineInputs,
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

export type UseMosaicSparklineOptions = Omit<SparklineClientOptions, 'coordinator'> & {
  /**
   * Defaults to the nearest `MosaicProvider`, then the global coordinator (the
   * global only when there is no provider; a `coordinator={null}` provider throws).
   */
  coordinator?: Coordinator;
} & QueryKeyOptions;

export type UseMosaicSparklineResult = SparklineClientState & {
  client: SparklineClient;
};

/**
 * Controlled binding over `createSparklineClient`. The declarative `x`/`y`
 * shapes are structural (they define the query, like `column` elsewhere);
 * `from` is latest-ref; `inputs.keys` — typically derived from a rows
 * client's visible page — is value-diffed, so a re-render with the same keys
 * never re-queries and a keys change re-queries exactly once.
 */
export function useMosaicSparkline(options: UseMosaicSparklineOptions): UseMosaicSparklineResult {
  const coordinator = useMosaicCoordinator(options.coordinator);
  const enabled = options.enabled ?? true;
  const from = useStableQuerySource(options.from);

  const client = useBoundClient<SparklineInputs, SparklineClient>({
    create: () => createSparklineClient({ ...options, coordinator, enabled: false }),
    structuralKey: [
      coordinator,
      options.filterBy,
      options.havingBy,
      skipSourcesKey(options.skipSources),
      options.inputMode,
      options.filterStable,
      options.key,
      options.columnPaths,
      options.x.column,
      options.x.step,
      options.x.interval,
      options.y.agg,
      options.y.column,
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
