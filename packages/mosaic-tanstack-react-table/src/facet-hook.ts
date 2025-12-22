import * as React from 'react';
import { MosaicFacetMenu } from '@nozzleio/mosaic-tanstack-table-core';
import { useStore } from '@tanstack/react-store';
import type { MosaicFacetMenuOptions } from '@nozzleio/mosaic-tanstack-table-core';

/**
 * React hook to manage the state and lifecycle of a Mosaic Facet Menu.
 */
export function useMosaicFacetMenu(options: MosaicFacetMenuOptions) {
  // 1. Instantiate the stable client once
  const [client] = React.useState(() => new MosaicFacetMenu(options));

  // 2. Sync options updates to the stable client
  React.useEffect(() => {
    client.updateOptions(options);
  }, [client, options]);

  // 3. Subscribe to the store
  const state = useStore(client.store);

  // 4. Connect/Disconnect lifecycle
  // Only connect to the coordinator when the facet is enabled (e.g. menu is open).
  // This prevents idle clients from responding to selection changes with null queries.
  React.useEffect(() => {
    if (options.enabled) {
      const cleanup = client.connect();
      return () => cleanup();
    }
  }, [client, options.enabled]);

  return {
    /** Raw options from the database (respecting limit/filters) */
    options: state.options,
    /**
     * Merged options for UI display.
     * Guaranteed to include currently selected values, even if they aren't in the raw options.
     */
    displayOptions: state.displayOptions,
    loading: state.loading,
    selectedValues: state.selectedValues,
    /**
     * Sets the search term. Debounced internally by the core client.
     */
    setSearchTerm: (term: string) => client.setSearchTerm(term),
    /**
     * Toggles a value in the selection set.
     * Pass `null` to clear all selections.
     */
    toggle: (value: string | number | null) => client.toggle(value),
    // Deprecated alias
    select: (value: string | null) => client.toggle(value),
    client,
  };
}
