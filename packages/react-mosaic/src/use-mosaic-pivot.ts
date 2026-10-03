import { createPivotClient } from '@nozzleio/mosaic-core';
import type {
  PivotClient,
  PivotClientOptions,
  PivotClientState,
  RowsInputs,
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

export type UseMosaicPivotOptions<TRow> = Omit<PivotClientOptions<TRow>, 'coordinator'> & {
  /**
   * Defaults to the nearest `MosaicProvider`, then the global coordinator (the
   * global only when there is no provider; a `coordinator={null}` provider throws).
   */
  coordinator?: Coordinator;
} & QueryKeyOptions;

export type UseMosaicPivotResult<TRow> = PivotClientState<TRow> & {
  client: PivotClient<TRow>;
};

/**
 * Controlled binding over `createPivotClient`. The pivot shape (`on`,
 * `using`, `groupBy`, `in`) is structural — it is plain JSON, so it is
 * compared by value, and changing it recreates the client; `from` and
 * `coerce` are latest-ref (a `queryKey` change re-queries without
 * recreating); `inputs` (orderBy/limit/offset) value-diffed.
 */
export function useMosaicPivot<TRow>(
  options: UseMosaicPivotOptions<TRow>,
): UseMosaicPivotResult<TRow> {
  const coordinator = useMosaicCoordinator(options.coordinator);
  const enabled = options.enabled ?? true;
  const from = useStableQuerySource(options.from);

  const client = useBoundClient<RowsInputs, PivotClient<TRow>>({
    create: () => createPivotClient<TRow>({ ...options, coordinator, enabled: false }),
    structuralKey: [
      coordinator,
      options.filterBy,
      options.havingBy,
      skipSourcesKey(options.skipSources),
      options.inputMode,
      options.filterStable,
      options.on,
      options.columnPaths,
      JSON.stringify(options.using),
      options.groupBy.join('\u0000'),
      JSON.stringify(options.in ?? null),
      ...paramsKey(options.params),
    ],
    inputs: options.inputs,
    enabled,
    queryKey: options.queryKey,
    sync: (c) => {
      c.setQuery(from);
      c.setCoerce(options.coerce);
    },
  });

  const state = useSelector(client.store, (s) => s);
  return { ...state, status: deriveStatus(state.status, enabled), client };
}
