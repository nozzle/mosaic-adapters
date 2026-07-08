import { useSelector } from '@tanstack/react-store';
import { createSparklineClient } from '@nozzleio/mosaic-core';
import { deriveStatus, paramsKey, useBoundClient } from './use-data-client';
import { useMosaicCoordinator } from './context';
import type { Coordinator } from '@uwdata/mosaic-core';
import type {
  SparklineClient,
  SparklineClientOptions,
  SparklineClientState,
  SparklineInputs,
} from '@nozzleio/mosaic-core';

export type UseMosaicSparklineOptions = Omit<
  SparklineClientOptions,
  'coordinator'
> & {
  /** Defaults to the nearest `MosaicProvider`, then the global coordinator. */
  coordinator?: Coordinator;
};

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
export function useMosaicSparkline(
  options: UseMosaicSparklineOptions,
): UseMosaicSparklineResult {
  const coordinator = useMosaicCoordinator(options.coordinator);
  const enabled = options.enabled ?? true;

  const client = useBoundClient<SparklineInputs, SparklineClient>({
    create: () =>
      createSparklineClient({ ...options, coordinator, enabled: false }),
    structuralKey: [
      coordinator,
      options.filterBy,
      options.havingBy,
      options.inputMode,
      options.filterStable,
      options.key,
      options.x.column,
      options.x.step,
      options.x.interval,
      options.y.agg,
      options.y.column,
      ...paramsKey(options.params),
    ],
    inputs: options.inputs,
    enabled,
    sync: (c) => {
      c.setQuery(options.from);
    },
  });

  const state = useSelector(client.store, (s) => s);
  return { ...state, status: deriveStatus(state.status, enabled), client };
}
