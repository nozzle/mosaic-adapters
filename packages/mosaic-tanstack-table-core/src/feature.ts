import type { RowData, Table, TableFeature } from '@tanstack/table-core';
import type { MosaicDataTable } from './data-table';

/**
 * Creates a TanStack Table Feature that injects the Mosaic Client API
 * directly into the table instance.
 *
 * This exposes the 'mosaicDataTable' property on the table instance,
 * providing access to facets, total counts, and the underlying client.
 */
export const createMosaicFeature = <TData extends RowData, TValue = any>(
  client: MosaicDataTable<TData, TValue>,
): TableFeature<TData> => {
  return {
    createTable: (table: Table<TData>) => {
      Object.assign(table, {
        mosaicDataTable: {
          requestFacet: (columnId: string, type: string) =>
            client.requestFacet(columnId, type),
          requestTotalCount: () => client.sidecarManager.requestTotalCount(),
          client: client,
        },
      });
    },
  };
};
