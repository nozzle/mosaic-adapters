import * as React from 'react';
import { createMosaicDataTableClient } from '@nozzleio/mosaic-tanstack-table-core';
import { shallow, useStore } from '@tanstack/react-store';
import { useCoordinator } from '@nozzleio/react-mosaic';
import type {
  FlatGroupedRow,
  GroupLevel,
  GroupMetric,
  LeafColumn,
  MosaicDataTable,
  MosaicDataTableColumnDefMetaOptions,
  MosaicDataTableOptions,
  MosaicDataTableStore,
  PrimitiveSqlValue,
} from '@nozzleio/mosaic-tanstack-table-core';
import type { RowData, TableOptions } from '@tanstack/react-table';

export type {
  FlatGroupedRow,
  GroupLevel,
  GroupMetric,
  LeafColumn,
  MosaicDataTable,
  MosaicDataTableColumnDefMetaOptions,
  MosaicDataTableOptions,
  MosaicDataTableStore,
  PrimitiveSqlValue,
};

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
  const normalizedOptions = React.useMemo(
    () => ({
      ...options,
      coordinator: options.coordinator ?? contextCoordinator,
      enabled: options.enabled ?? true,
    }),
    [contextCoordinator, options],
  );

  const [client] = React.useState(() =>
    createMosaicDataTableClient<TData, TValue>(normalizedOptions),
  );

  React.useEffect(() => {
    client.updateOptions(normalizedOptions);
  }, [client, normalizedOptions]);

  React.useEffect(() => {
    if (!normalizedOptions.enabled) {
      client.disconnect();
      return;
    }

    const unsub = client.connect();
    return unsub;
  }, [client, normalizedOptions.enabled]);

  const store = useStore(client.store, (s) => s, shallow);

  const tableOptions = React.useMemo(
    () => ({
      ...client.getTableOptions(store),
    }),
    [client, store],
  );

  return { tableOptions, client };
}

/**
 * React hook that subscribes to the grouped-mode state of a MosaicDataTable.
 * Returns reactive `expanded`, `loadingGroupIds`, `totalRootRows`, and `isRootLoading`.
 *
 * @example
 * const { client } = useMosaicReactTable({ ... groupBy: { ... } });
 * const { isRootLoading, totalRootRows } = useGroupedTableState(client);
 */
export function useGroupedTableState<TData extends RowData>(
  client: MosaicDataTable<TData, any>,
): MosaicDataTableStore<TData, any>['_grouped'] {
  return useStore(client.groupedStore, (s) => s, shallow);
}
