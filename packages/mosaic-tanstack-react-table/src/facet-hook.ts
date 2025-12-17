// packages/mosaic-tanstack-react-table/src/facet-hook.ts

import * as React from 'react';
import { MosaicFacetMenu } from '@nozzleio/mosaic-tanstack-table-core';
import { useStore } from '@tanstack/react-store';
import type { MosaicFacetMenuOptions } from '@nozzleio/mosaic-tanstack-table-core';

export function useMosaicFacetMenu(options: MosaicFacetMenuOptions) {
  // Destructure options to allow exhaustive dependencies in useMemo
  const {
    table,
    column,
    selection,
    filterBy,
    coordinator,
    sortMode,
    limit,
    debugName,
    isArrayColumn,
  } = options;

  // 1. Instantiate the stable client once
  // We use a memo pattern to recreate the client if key props change.
  const client = React.useMemo(() => {
    return new MosaicFacetMenu({
      table,
      column,
      selection,
      filterBy,
      coordinator,
      sortMode,
      limit,
      debugName,
      isArrayColumn,
    });
  }, [
    table,
    column,
    selection,
    filterBy,
    coordinator,
    sortMode,
    limit,
    debugName,
    isArrayColumn,
  ]);

  // 2. Subscribe to the store
  const state = useStore(client.store);

  // 3. Connect/Disconnect lifecycle
  React.useEffect(() => {
    const cleanup = client.connect();
    return () => cleanup();
  }, [client]);

  return {
    options: state.options,
    loading: state.loading,
    setSearchTerm: (term: string) => client.setSearchTerm(term),
    select: (value: string | null) => client.select(value),
    client,
  };
}
