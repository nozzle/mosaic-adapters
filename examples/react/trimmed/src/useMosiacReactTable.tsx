// This is an example of the React-specific hook that'd be used to allow
// Mosaic's data to drive an instance of TanStack Table in an app.
import * as React from 'react';
import { createMosaicDataTableClient } from '@nozzleio/mosaic-tanstack-table-core/trimmed';
import { useStore } from '@tanstack/react-store';
import type { MosaicDataTableOptions } from '@nozzleio/mosaic-tanstack-table-core/trimmed';
import type { RowData } from '@tanstack/react-table';

export type {
  MosaicDataTableColumnDef,
  MosaicDataTableColumnDefOptions,
} from '@nozzleio/mosaic-tanstack-table-core/trimmed';

export function useMosaicReactTable<TData extends RowData, TValue = any>(
  options: MosaicDataTableOptions<TData, TValue>,
) {
  const client = React.useRef(
    createMosaicDataTableClient<TData, TValue>(options),
  );
  const store = useStore(client.current.store);

  const tableOptions = React.useMemo(
    () => client.current.getTableOptions(store),
    [store],
  );

  React.useEffect(() => {
    client.current.updateOptions(options);
    return () => {
      //
    };
  }, [options]);

  return { tableOptions } as const;
}
