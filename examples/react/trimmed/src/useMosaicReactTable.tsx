// This is an example of the React-specific hook that'd be used to allow
// Mosaic's data to drive an instance of TanStack Table in an app.
import * as React from 'react';
import { createMosaicDataTableClient } from '@nozzleio/mosaic-tanstack-table-core/trimmed';
import { useStore } from '@tanstack/react-store';
import type { MosaicDataTableOptions } from '@nozzleio/mosaic-tanstack-table-core/trimmed';
import type { RowData, TableOptions } from '@tanstack/react-table';

export type * from '@nozzleio/mosaic-tanstack-table-core/trimmed';

export function useMosaicReactTable<TData extends RowData, TValue = any>(
  options: MosaicDataTableOptions<TData, TValue>,
): { tableOptions: TableOptions<TData> } {
  // Create a stable `MosaicDataTable` client instance.
  const client = React.useRef(
    createMosaicDataTableClient<TData, TValue>(options),
  );

  // Subscribe to the client's store to get framework-land updates.
  const store = useStore(client.current.store);

  // Get the current table options from the client.
  const tableOptions = React.useMemo(
    () => client.current.getTableOptions(store),
    [store],
  );

  React.useEffect(() => {
    // Update the client options when they change.
    client.current.updateOptions(options);
  }, [options]);

  React.useEffect(() => {
    // Connect the client to the coordinator on mount, and disconnect on unmount.
    const unsub = client.current.connect();
    return unsub;
  }, []);

  return { tableOptions };
}
