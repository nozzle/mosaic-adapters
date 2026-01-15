/* eslint-disable unused-imports/no-unused-vars */
/**
 * Module augmentation for TanStack Table to support Mosaic-specific metadata.
 * Extends the ColumnMeta interface to include configuration for SQL column mapping,
 * filtering strategies, and faceting modes.
 */
import '@tanstack/table-core';
import type { RowData } from '@tanstack/table-core';
import type { MosaicDataTableColumnDefMetaOptions } from './types';

declare module '@tanstack/table-core' {
  interface ColumnMeta<
    TData extends RowData,
    TValue,
  > extends MosaicDataTableColumnDefMetaOptions<TValue> {}
}
