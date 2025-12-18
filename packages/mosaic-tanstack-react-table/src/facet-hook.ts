// packages/mosaic-tanstack-react-table/src/facet-hook.ts

import * as React from 'react';
import { MosaicFacetMenu } from '@nozzleio/mosaic-tanstack-table-core';
import { useStore } from '@tanstack/react-store';
import type { MosaicFacetMenuOptions } from '@nozzleio/mosaic-tanstack-table-core';

export function useMosaicFacetMenu(options: MosaicFacetMenuOptions) {
  // 1. Instantiate the stable client once
  // We use useState lazy initialization to ensure the client is created exactly once per component lifecycle.
  // This prevents the "Identity Mismatch" issue where a new client (Source B) tries to clear a filter created by Source A.
  const [client] = React.useState(() => new MosaicFacetMenu(options));

  // 2. Sync options updates to the stable client
  // This allows us to react to prop changes (like externalContext changing) without destroying the client.
  React.useEffect(() => {
    client.updateOptions(options);
  }, [client, options]);

  // 3. Subscribe to the store
  const state = useStore(client.store);

  // 4. Connect/Disconnect lifecycle
  React.useEffect(() => {
    const cleanup = client.connect();
    return () => cleanup();
  }, [client]);

  return {
    options: state.options,
    loading: state.loading,
    selectedValues: state.selectedValues,
    setSearchTerm: (term: string) => client.setSearchTerm(term),
    /**
     * Toggles a value in the selection set.
     * Pass `null` to clear all selections.
     */
    toggle: (value: string | number | null) => client.toggle(value),
    // Deprecated: Alias select to toggle for backward compatibility during refactor, or logic switch
    select: (value: string | null) => client.toggle(value),
    client,
  };
}
