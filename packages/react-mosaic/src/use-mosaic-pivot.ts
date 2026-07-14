import { useSelector } from '@tanstack/react-store';
import { createPivotClient } from '@nozzleio/mosaic-core';
import {
  deriveStatus,
  paramsKey,
  skipSourcesKey,
  useBoundClient,
} from './use-data-client';
import { useMosaicCoordinator } from './context';
import type { Coordinator } from '@uwdata/mosaic-core';
import type {
  PivotClient,
  PivotClientOptions,
  PivotClientState,
  RowsInputs,
} from '@nozzleio/mosaic-core';

export type UseMosaicPivotOptions<TRow> = Omit<
  PivotClientOptions<TRow>,
  'coordinator'
> & {
  /** Defaults to the nearest `MosaicProvider`, then the global coordinator. */
  coordinator?: Coordinator;
};

export type UseMosaicPivotResult<TRow> = PivotClientState<TRow> & {
  client: PivotClient<TRow>;
};

/**
 * Controlled binding over `createPivotClient`. The pivot shape (`on`,
 * `using`, `groupBy`, `in`) is structural — it is plain JSON, so it is
 * compared by value, and changing it recreates the client; `from` and
 * `coerce` are latest-ref; `inputs` (orderBy/limit/offset) value-diffed.
 */
export function useMosaicPivot<TRow>(
  options: UseMosaicPivotOptions<TRow>,
): UseMosaicPivotResult<TRow> {
  const coordinator = useMosaicCoordinator(options.coordinator);
  const enabled = options.enabled ?? true;

  const client = useBoundClient<RowsInputs, PivotClient<TRow>>({
    create: () =>
      createPivotClient<TRow>({ ...options, coordinator, enabled: false }),
    structuralKey: [
      coordinator,
      options.filterBy,
      options.havingBy,
      skipSourcesKey(options.skipSources),
      options.inputMode,
      options.filterStable,
      options.on,
      JSON.stringify(options.using),
      options.groupBy.join('\u0000'),
      JSON.stringify(options.in ?? null),
      ...paramsKey(options.params),
    ],
    inputs: options.inputs,
    enabled,
    sync: (c) => {
      c.setQuery(options.from);
      c.setCoerce(options.coerce);
    },
  });

  const state = useSelector(client.store, (s) => s);
  return { ...state, status: deriveStatus(state.status, enabled), client };
}
