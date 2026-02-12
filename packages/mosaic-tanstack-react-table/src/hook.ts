import * as React from 'react';
import { createMosaicDataTableClient } from '@nozzleio/mosaic-tanstack-table-core';
import { useStore } from '@tanstack/react-store';
import { useCoordinator } from '@nozzleio/react-mosaic';
import type {
  MosaicDataTable,
  MosaicDataTableOptions,
  PrimitiveSqlValue,
} from '@nozzleio/mosaic-tanstack-table-core';
import type { RowData, TableOptions } from '@tanstack/react-table';

export type * from '@nozzleio/mosaic-tanstack-table-core';

/**
 * React hook to instantiate and manage a MosaicDataTable client.
 * Provides integration between Mosaic's coordinator and TanStack Table's state management.
 *
 * NOTE: 'mapping' is recommended for type safety but optional if using metadata.
 *
 * When `options.enabled` is false, the client will be disconnected and won't
 * respond to coordinator changes. This is useful for components that stay mounted
 * but are hidden (e.g., tabs with display:none) to prevent queries to wrong backends.
 */
export function useMosaicReactTable<
  TData extends RowData,
  TValue extends PrimitiveSqlValue = PrimitiveSqlValue,
>(
  options: MosaicDataTableOptions<TData, TValue>,
): {
  tableOptions: TableOptions<TData>;
  client: MosaicDataTable<TData, TValue>;
} {
  const contextCoordinator = useCoordinator();
  const coordinator = options.coordinator ?? contextCoordinator;
  const enabled = options.enabled ?? true;

  const [client] = React.useState(() =>
    createMosaicDataTableClient<TData, TValue>(options),
  );

  // Only set coordinator when enabled - prevents reconnection to wrong backend
  React.useEffect(() => {
    if (!enabled) {
      return;
    }
    client.setCoordinator(coordinator);
  }, [client, coordinator, enabled]);

  React.useEffect(() => {
    client.updateOptions(options);
  }, [options, client]);

  // Connect/disconnect based on enabled state
  React.useEffect(() => {
    if (!enabled) {
      // Disconnect when disabled to stop any pending queries
      client.disconnect();
      return;
    }

    const unsub = client.connect();
    return unsub;
  }, [client, coordinator, enabled]);

  const store = useStore(client.store);

  const tableOptions = React.useMemo(
    () => ({
      ...client.getTableOptions(store),
    }),
    [client, store],
  );

  return { tableOptions, client };
}
