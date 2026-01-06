import * as React from 'react';
import { createMosaicDataTableClient } from '@nozzleio/mosaic-tanstack-table-core';
import { useStore } from '@tanstack/react-store';
import { useCoordinator } from '@nozzleio/react-mosaic';
import type {
  MosaicColumnMapping,
  MosaicDataTable,
  MosaicDataTableOptions,
} from '@nozzleio/mosaic-tanstack-table-core';
import type { RowData, TableOptions } from '@tanstack/react-table';

export type * from '@nozzleio/mosaic-tanstack-table-core';

/**
 * React hook to instantiate and manage a MosaicDataTable client.
 * Provides integration between Mosaic's coordinator and TanStack Table's state management.
 *
 * NOW REQUIRED: 'mapping' and 'schema' for type safety.
 */
export function useMosaicReactTable<TData extends RowData, TValue = any>(
  options: MosaicDataTableOptions<TData, TValue> & {
    // Explicitly require mapping in the React Hook API to enforce safety in UI layer
    mapping: MosaicColumnMapping<TData>;
  },
): {
  tableOptions: TableOptions<TData>;
  client: MosaicDataTable<TData, TValue>;
} {
  const contextCoordinator = useCoordinator();
  const coordinator = options.coordinator ?? contextCoordinator;

  const [client] = React.useState(() =>
    createMosaicDataTableClient<TData, TValue>(options),
  );

  React.useEffect(() => {
    client.setCoordinator(coordinator);
  }, [client, coordinator]);

  React.useEffect(() => {
    client.updateOptions(options);
  }, [options, client]);

  React.useEffect(() => {
    const unsub = client.connect();
    return unsub;
  }, [client, coordinator]);

  const store = useStore(client.store);

  const tableOptions = React.useMemo(
    () => client.getTableOptions(store),
    [client, store],
  );

  return { tableOptions, client };
}
