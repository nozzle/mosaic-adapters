// This is an example of the React-specific hook that'd be used to allow
// Mosaic's data to drive an instance of TanStack Table in an app.
import * as React from 'react';
import { createMosaicDataTableClient } from '@nozzleio/mosaic-tanstack-table-core/trimmed';
import { useStore } from '@tanstack/react-store';
import type { MosaicDataTableOptions } from '@nozzleio/mosaic-tanstack-table-core/trimmed';

export function useMosaicReactTable<TData = unknown>(
  options: MosaicDataTableOptions,
) {
  const client = React.useRef(createMosaicDataTableClient(options));
  const store = useStore(client.current.store);

  const tableOptions = React.useMemo(
    () => client.current.getTableOptions(store),
    [store],
  );

  return { tableOptions } as const;
}
