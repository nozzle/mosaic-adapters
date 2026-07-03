import { useStore } from '@tanstack/react-store';
import { createFacetClient } from '@nozzleio/mosaic-core';
import { deriveStatus, paramsKey, useBoundClient } from './use-data-client';
import { useMosaicCoordinator } from './context';
import type { Coordinator } from '@uwdata/mosaic-core';
import type {
  FacetClient,
  FacetClientOptions,
  FacetClientState,
  FacetInputs,
} from '@nozzleio/mosaic-core';

export type UseMosaicFacetOptions = Omit<FacetClientOptions, 'coordinator'> & {
  /** Defaults to the nearest `MosaicProvider`, then the global coordinator. */
  coordinator?: Coordinator;
};

export type UseMosaicFacetResult = FacetClientState & {
  client: FacetClient;
};

/**
 * Controlled binding over `createFacetClient`. Same identity rules as
 * `useMosaicRows`: everything without a core setter is structural, `from`
 * is latest-ref, `inputs` (search/limit) value-diffed, `enabled` via
 * `setEnabled` — so `enabled: open` gates option queries to while a
 * dropdown is actually open.
 *
 * `persist` is structural (no core setter): a new persister identity is a
 * new storage location, so the client is recreated and re-hydrated. Keep the
 * persister identity stable (module scope or `useMemo`) or the client
 * recreates every render.
 */
export function useMosaicFacet(
  options: UseMosaicFacetOptions,
): UseMosaicFacetResult {
  const coordinator = useMosaicCoordinator(options.coordinator);
  const enabled = options.enabled ?? true;

  const client = useBoundClient<FacetInputs, FacetClient>({
    create: () =>
      createFacetClient({ ...options, coordinator, enabled: false }),
    structuralKey: [
      coordinator,
      options.filterBy,
      options.havingBy,
      options.inputMode,
      options.filterStable,
      options.column,
      options.arrayColumn,
      options.counts,
      options.sort,
      options.select,
      options.publish?.as,
      options.persist,
      ...paramsKey(options.params),
    ],
    inputs: options.inputs,
    enabled,
    sync: (c) => {
      c.setQuery(options.from);
    },
  });

  const state = useStore(client.store, (s) => s);
  return { ...state, status: deriveStatus(state.status, enabled), client };
}
