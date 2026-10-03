import { createRowsClient, isFilterSetPublishTarget } from '@nozzleio/mosaic-core';
import type {
  RowsClient,
  RowsClientOptions,
  RowsClientState,
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

export type UseMosaicRowsOptions<TRow> = Omit<RowsClientOptions<TRow>, 'coordinator'> & {
  /**
   * Defaults to the nearest `MosaicProvider`, then the global coordinator (the
   * global only when there is no provider; a `coordinator={null}` provider throws).
   */
  coordinator?: Coordinator;
} & QueryKeyOptions;

export type UseMosaicRowsResult<TRow> = RowsClientState<TRow> & {
  client: RowsClient<TRow>;
};

/**
 * Controlled binding over `createRowsClient`. Identity rules:
 *
 * - `coordinator`, `filterBy`, `havingBy`, `skipSources`, `params`, `publish`,
 *   `inputMode`, `filterStable`, `coalesceFilterBy`, `rowCount` are
 *   structural — changing any of them destroys and recreates the client.
 * - `query` and `coerce` are held by latest-ref — new function identities
 *   never recreate and never re-query. List what a compiled `query` depends
 *   on in `queryKey` to re-query when it changes (`client.invalidate()`).
 * - `meta` (debugging metadata) is held by latest-ref via `setMeta` — never
 *   structural, never re-queries.
 * - `inputs` is value-diffed into `setInputs`; `enabled` into `setEnabled`.
 * - `persist` is structural (no core setter): a new persister identity is a
 *   new storage location, so the client is recreated and re-hydrated. Keep
 *   the persister identity stable (module scope or `useMemo`) or the client
 *   recreates every render.
 *
 * `status` follows React-Query semantics: 'pending' from the first render
 * while enabled, 'idle' only while disabled.
 */
export function useMosaicRows<TRow>(
  options: UseMosaicRowsOptions<TRow>,
): UseMosaicRowsResult<TRow> {
  const coordinator = useMosaicCoordinator(options.coordinator);
  const enabled = options.enabled ?? true;
  const query = useStableQuerySource(options.query);

  // publish.select is a union: RowsPublishTarget (`as`, Selection identity +
  // `source`) vs RowsFilterSetPublishTarget (`into`) — capture whichever arm
  // is active. columns/fields exist on both arms and stay below. Same
  // rationale as `persist`: a change in target recreates the client.
  const select = options.publish?.select;
  const selectKey = isFilterSetPublishTarget(select)
    ? [select.into, select.id, select.kind, select.label, select.target]
    : [select?.as, select?.source];

  const client = useBoundClient<RowsInputs, RowsClient<TRow>>({
    create: () => createRowsClient<TRow>({ ...options, coordinator, enabled: false }),
    structuralKey: [
      coordinator,
      options.filterBy,
      options.havingBy,
      skipSourcesKey(options.skipSources),
      options.inputMode,
      options.filterStable,
      options.coalesceFilterBy,
      options.rowCount,
      ...selectKey,
      columnsKey(options.publish?.select?.columns),
      columnsKey(options.publish?.select?.fields),
      options.publish?.hover?.as,
      columnsKey(options.publish?.hover?.columns),
      columnsKey(options.publish?.hover?.fields),
      options.publish?.hover?.source,
      options.publish?.hover?.throttleMs,
      options.persist,
      ...paramsKey(options.params),
    ],
    inputs: options.inputs,
    enabled,
    queryKey: options.queryKey,
    meta: options.meta,
    sync: (c) => {
      c.setQuery(query);
      c.setCoerce(options.coerce);
    },
  });

  const state = useSelector(client.store, (s) => s);
  return { ...state, status: deriveStatus(state.status, enabled), client };
}

function columnsKey(columns: Array<string> | undefined): string | undefined {
  return columns?.join('\u0000');
}
