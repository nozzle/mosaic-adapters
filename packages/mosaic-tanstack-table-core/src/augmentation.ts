import '@tanstack/table-core';
import type { RowData } from '@tanstack/table-core';
import type { MosaicDataTable } from './data-table';
import type { MosaicDataTableColumnDefMetaOptions } from './types';

/**
 * Module augmentation for TanStack Table to support Mosaic-specific metadata.
 * Extends the ColumnMeta interface to include configuration for SQL column mapping,
 * filtering strategies, and faceting modes.
 */
declare module '@tanstack/table-core' {
  // Extend the Table Instance with the first-class Mosaic API
  interface Table<TData extends RowData> {
    mosaic: {
      requestFacet: (columnId: string, type: string) => void;
      requestTotalCount: () => void;
      client: MosaicDataTable<TData, any>;
    };
  }

  interface ColumnMeta<
    TData extends RowData,
    TValue,
  > extends MosaicDataTableColumnDefMetaOptions<TValue> {}
}
