import '@tanstack/table-core';
import type { RowData } from '@tanstack/table-core';
import type { MosaicDataTableColumnDefMetaOptions } from './types';

declare module '@tanstack/table-core' {
  // Pass TValue into the Options generic to enable strict filtering/faceting types
  interface ColumnMeta<
    TData extends RowData,
    TValue,
  > extends MosaicDataTableColumnDefMetaOptions<TValue> {}
}
