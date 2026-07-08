import { useSelector } from '@tanstack/react-store';
import {
  createRowsClient,
  isFilterSetPublishTarget,
} from '@nozzleio/mosaic-core';
import { deriveStatus, paramsKey, useBoundClient } from './use-data-client';
import { useMosaicCoordinator } from './context';
import type { Coordinator } from '@uwdata/mosaic-core';
import type {
  RowsClient,
  RowsClientOptions,
  RowsClientState,
  RowsInputs,
} from '@nozzleio/mosaic-core';

export type UseMosaicRowsOptions<TRow> = Omit<
  RowsClientOptions<TRow>,
  'coordinator'
> & {
  /** Defaults to the nearest `MosaicProvider`, then the global coordinator. */
  coordinator?: Coordinator;
};

export type UseMosaicRowsResult<TRow> = RowsClientState<TRow> & {
  client: RowsClient<TRow>;
};

/**
 * Controlled binding over `createRowsClient`. Identity rules:
 *
 * - `coordinator`, `filterBy`, `havingBy`, `params`, `publish`, `inputMode`,
 *   `filterStable`, `rowCount` are structural — changing any of them
 *   destroys and recreates the client.
 * - `query` and `coerce` are held by latest-ref — new function identities
 *   never recreate and never re-query.
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

  // publish.select is a union: RowsPublishTarget (`as`, Selection identity +
  // `source`) vs RowsFilterSetPublishTarget (`into`) — capture whichever arm
  // is active. columns/fields exist on both arms and stay below. Same
  // rationale as `persist`: a change in target recreates the client.
  const select = options.publish?.select;
  const selectKey = isFilterSetPublishTarget(select)
    ? [select.into, select.id, select.kind, select.label]
    : [select?.as, select?.source];

  const client = useBoundClient<RowsInputs, RowsClient<TRow>>({
    create: () =>
      createRowsClient<TRow>({ ...options, coordinator, enabled: false }),
    structuralKey: [
      coordinator,
      options.filterBy,
      options.havingBy,
      options.inputMode,
      options.filterStable,
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
    sync: (c) => {
      c.setQuery(options.query);
      c.setCoerce(options.coerce);
    },
  });

  const state = useSelector(client.store, (s) => s);
  return { ...state, status: deriveStatus(state.status, enabled), client };
}

function columnsKey(columns: Array<string> | undefined): string | undefined {
  return columns?.join('\u0000');
}
