import * as React from 'react';
import { createMosaicDataTableClient } from '@nozzleio/mosaic-tanstack-table-core';
import { useStore } from '@tanstack/react-store';
import type {
  MosaicDataTable,
  MosaicDataTableOptions,
} from '@nozzleio/mosaic-tanstack-table-core';
import type { RowData, TableOptions } from '@tanstack/react-table';

export type * from '@nozzleio/mosaic-tanstack-table-core';

export function useMosaicReactTable<TData extends RowData, TValue = any>(
  options: MosaicDataTableOptions<TData, TValue>,
): {
  tableOptions: TableOptions<TData>;
  client: MosaicDataTable<TData, TValue>;
} {
  // Create a stable `MosaicDataTable` client instance.
  // Use useState lazy initializer to ensure the client is created exactly once per component lifecycle.
  const [client] = React.useState(() =>
    createMosaicDataTableClient<TData, TValue>(options),
  );

  // Subscribe to the client's store to get framework-land updates.
  const store = useStore(client.store);

  // Get the current table options from the client.
  const tableOptions = React.useMemo(
    () => client.getTableOptions(store),
    [client, store],
  );

  // Update the client options when they change.
  // We rely on standard React dependency checks here.
  React.useEffect(() => {
    client.updateOptions(options);
  }, [options, client]);

  React.useEffect(() => {
    // Connect the client to the coordinator on mount, and disconnect on unmount.
    const unsub = client.connect();
    return unsub;
  }, [client]);

  return { tableOptions, client };
}
