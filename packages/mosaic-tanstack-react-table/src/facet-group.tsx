/**
 * Context Provider and Hook for Query Consolidation (MosaicFacetGroup).
 * Allows multiple UI components to register requirements to a single
 * MosaicFacetClient, ensuring only one SQL query is executed for the entire group.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useStore } from '@tanstack/react-store';
import { MosaicFacetClient } from '@nozzleio/mosaic-tanstack-table-core';
import type {
  ColumnType,
  FacetRequest,
  MosaicFacetClientOptions,
} from '@nozzleio/mosaic-tanstack-table-core';

interface FacetGroupContextType {
  client: MosaicFacetClient;
  register: (id: string, req: FacetRequest) => void;
}

const FacetGroupContext = createContext<FacetGroupContextType | null>(null);

export function MosaicFacetGroup({
  children,
  selection,
  ...options
}: React.PropsWithChildren<MosaicFacetClientOptions>) {
  // 1. Create the single consolidated client
  // Using lazy initializer to ensure exactly one instance
  // Pass `selection` explicitly alongside other options to the client constructor
  const [client] = useState(
    () => new MosaicFacetClient({ ...options, selection }),
  );

  // 2. Manage Lifecycle
  // We explicitly include 'selection' and 'options.filterBy' in dependencies to ensure updates propagate
  useEffect(() => {
    client.updateOptions({ ...options, selection });

    const cleanup = client.connect();
    return () => cleanup();
  }, [client, options, selection]);

  const contextValue = React.useMemo(
    () => ({
      client,
      register: (id: string, req: FacetRequest) => client.register(id, req),
    }),
    [client],
  );

  return (
    <FacetGroupContext.Provider value={contextValue}>
      {children}
    </FacetGroupContext.Provider>
  );
}

/**
 * Hook to consume data from the MosaicFacetGroup.
 * Replaces useMosaicFacetMenu for components inside a FacetGroup.
 */
export function useConsolidatedFacet({
  column,
  type = 'unique',
  ...rest
}: {
  column: string;
  type?: 'unique' | 'minmax' | 'totalCount';
  limit?: number;
  sortMode?: 'alpha' | 'count';
  sqlColumn?: string;
  columnType?: ColumnType;
}) {
  const context = useContext(FacetGroupContext);
  if (!context) {
    throw new Error(
      'useConsolidatedFacet must be used within MosaicFacetGroup',
    );
  }

  // 1. Register on mount (and update if config changes)
  useEffect(() => {
    let req: FacetRequest;

    // Strict construction to satisfy the Discriminated Union type
    if (type === 'totalCount') {
      req = {
        type: 'totalCount',
        column,
      };
    } else if (type === 'minmax') {
      req = {
        type: 'minmax',
        column,
        sqlColumn: rest.sqlColumn || column,
        columnType: rest.columnType,
      };
    } else {
      // type === 'unique' (default)
      req = {
        type: 'unique',
        column,
        sqlColumn: rest.sqlColumn || column,
        limit: rest.limit,
        sortMode: rest.sortMode,
        columnType: rest.columnType,
      };
    }

    context.register(column, req);
    // Trigger initial fetch after registration
    context.client.requestUpdate();
  }, [
    column,
    context,
    type,
    rest.sqlColumn,
    rest.limit,
    rest.sortMode,
    rest.columnType,
  ]);

  // 2. Subscribe to the store for this specific column
  const facetData = useStore(
    context.client.store,
    (state) => state.facets[column],
  );
  const loading = useStore(context.client.store, (state) => state.loading);

  const toggle = React.useCallback(
    (val: any) => {
      context.client.handleInput(column, val);
    },
    [context.client, column],
  );

  return {
    options: facetData || [],
    loading,
    toggle,
    // Helper to match standard facet hook API
    selectedValues: [], // We'd need to expose selectedValues from client store to implement this fully
  };
}
