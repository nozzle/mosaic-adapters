import * as React from 'react';
import { MosaicFacetMenu } from '@nozzleio/mosaic-tanstack-table-core';
import { shallow, useStore } from '@tanstack/react-store';
import { useCoordinator } from '@nozzleio/react-mosaic';
import type {
  FacetValue,
  MosaicFacetMenuOptions,
} from '@nozzleio/mosaic-tanstack-table-core';

export type { FacetValue, MosaicFacetMenuOptions };

/**
 * React hook to manage the state and lifecycle of a Mosaic Facet Menu.
 * Connects a specific column's sidecar client to the UI.
 *
 * UPDATE: Exposes `loadMore` and `hasMore` for infinite scroll.
 */
export function useMosaicTableFacetMenu(options: MosaicFacetMenuOptions) {
  const contextCoordinator = useCoordinator();
  const normalizedOptions = React.useMemo(
    () => ({
      ...options,
      coordinator: options.coordinator ?? contextCoordinator,
      enabled: options.enabled ?? true,
    }),
    [contextCoordinator, options],
  );

  const [client] = React.useState(() => new MosaicFacetMenu(normalizedOptions));

  React.useEffect(() => {
    client.updateOptions(normalizedOptions);
  }, [client, normalizedOptions]);

  const state = useStore(
    client.store,
    (store) => ({
      options: store.options,
      displayOptions: store.displayOptions,
      loading: store.loading,
      selectedValues: store.selectedValues,
      hasMore: store.hasMore,
    }),
    shallow,
  );

  React.useEffect(() => {
    if (!normalizedOptions.enabled) {
      client.disconnect();
      return;
    }

    const cleanup = client.connect();
    return cleanup;
  }, [client, normalizedOptions.enabled]);

  const select = React.useCallback(
    (value: FacetValue) => {
      client.clear();
      if (value !== null) {
        client.toggle(value);
      }
    },
    [client],
  );

  return {
    options: state.options,
    displayOptions: state.displayOptions,
    loading: state.loading,
    selectedValues: state.selectedValues,
    hasMore: state.hasMore,
    setSearchTerm: (term: string) => client.setSearchTerm(term),
    toggle: (value: FacetValue) => client.toggle(value),
    select,
    clear: () => client.clear(),
    loadMore: () => client.loadMore(),
    client,
  };
}
