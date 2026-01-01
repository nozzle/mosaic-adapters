import * as React from 'react';
import { createMosaicDataTableClient } from '@nozzleio/mosaic-tanstack-table-core';
import { useStore } from '@tanstack/react-store';
import { useCoordinator } from '@nozzleio/mosaic-react-core';
import type {
  MosaicDataTable,
  MosaicDataTableOptions,
} from '@nozzleio/mosaic-tanstack-table-core';
import type { RowData, TableOptions } from '@tanstack/react-table';

export type * from '@nozzleio/mosaic-tanstack-table-core';

/**
 * React hook to instantiate and manage a MosaicDataTable client.
 * Provides integration between Mosaic's coordinator and TanStack Table's state management.
 */
export function useMosaicReactTable<TData extends RowData, TValue = any>(
  options: MosaicDataTableOptions<TData, TValue>,
): {
  tableOptions: TableOptions<TData>;
  client: MosaicDataTable<TData, TValue>;
} {
  // 1. Get the coordinator from Context (preferred) or Options (fallback)
  const contextCoordinator = useCoordinator();
  const coordinator = options.coordinator ?? contextCoordinator;

  // 2. Create a stable `MosaicDataTable` client instance.
  const [client] = React.useState(() =>
    createMosaicDataTableClient<TData, TValue>(options),
  );

  // 3. Sync the coordinator to the client
  // This allows the client to switch backends if the context changes (e.g. WASM -> Remote)
  React.useEffect(() => {
    client.setCoordinator(coordinator);
  }, [client, coordinator]);

  // 4. Update Client Options
  React.useEffect(() => {
    client.updateOptions(options);
  }, [options, client]);

  // 5. Connect Lifecycle
  // We use manual connect here instead of `useMosaicClient` because `MosaicDataTable`
  // has specific internal logic for initial data fetching and sidecar management
  // that is triggered via its own connect method.
  React.useEffect(() => {
    const unsub = client.connect();
    return unsub;
  }, [client, coordinator]);

  // 6. Subscribe to store updates
  const store = useStore(client.store);

  const tableOptions = React.useMemo(
    () => client.getTableOptions(store),
    [client, store],
  );

  return { tableOptions, client };
}
