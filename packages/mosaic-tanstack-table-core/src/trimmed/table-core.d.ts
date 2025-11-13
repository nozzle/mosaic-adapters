import '@tanstack/table-core';
import type { MosaicDataTableColumnDefMetaOptions } from './types';

declare module '@tanstack/table-core' {
  interface ColumnMeta<TData extends RowData, TValue>
    extends MosaicDataTableColumnDefMetaOptions {}
}
