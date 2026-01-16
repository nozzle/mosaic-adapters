import type { RowData, Table, TableFeature } from '@tanstack/react-table';
import type { MosaicDataTable } from '@nozzleio/mosaic-tanstack-table-core';

/**
 * Creates a TanStack Table Feature that injects the Mosaic Client API
 * directly into the table instance.
 *
 * This replaces the legacy pattern of injecting the client into `table.options.meta`.
 */
export const createMosaicFeature = <TData extends RowData, TValue = any>(
  client: MosaicDataTable<TData, TValue>,
): TableFeature<TData> => {
  return {
    createTable: (table: Table<TData>) => {
      Object.assign(table, {
        mosaic: {
          requestFacet: (columnId: string, type: string) =>
            client.requestFacet(columnId, type),
          requestTotalCount: () => client.sidecarManager.requestTotalCount(),
          client: client,
        },
      });
    },
  };
};
