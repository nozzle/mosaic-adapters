import * as React from 'react';
import { MosaicFacetMenu } from '@nozzleio/mosaic-tanstack-table-core';
import { useStore } from '@tanstack/react-store';
import { useCoordinator } from '@nozzleio/mosaic-react-core';
import type { MosaicFacetMenuOptions } from '@nozzleio/mosaic-tanstack-table-core';

/**
 * React hook to manage the state and lifecycle of a Mosaic Facet Menu.
 * Connects a specific column's sidecar client to the UI.
 */
export function useMosaicFacetMenu(options: MosaicFacetMenuOptions) {
  const contextCoordinator = useCoordinator();
  const coordinator = options.coordinator ?? contextCoordinator;

  // 1. Instantiate the stable client
  const [client] = React.useState(
    () => new MosaicFacetMenu({ ...options, coordinator }),
  );

  // 2. Sync options updates
  React.useEffect(() => {
    client.updateOptions({ ...options, coordinator });
  }, [client, options, coordinator]);

  // 3. Subscribe to the store
  const state = useStore(client.store);

  // 4. Connect/Disconnect lifecycle
  React.useEffect(() => {
    if (options.enabled !== false) {
      const cleanup = client.connect();
      return () => cleanup();
    }
  }, [client, options.enabled, coordinator]);

  return {
    options: state.options,
    displayOptions: state.displayOptions,
    loading: state.loading,
    selectedValues: state.selectedValues,
    setSearchTerm: (term: string) => client.setSearchTerm(term),
    toggle: (value: string | number | null) => client.toggle(value),
    select: (value: string | null) => client.toggle(value),
    client,
  };
}
