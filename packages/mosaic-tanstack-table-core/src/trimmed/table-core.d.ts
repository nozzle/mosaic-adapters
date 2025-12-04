import '@tanstack/table-core';
import type { RowData } from '@tanstack/table-core';
import type { MosaicDataTableColumnDefMetaOptions } from './types';

declare module '@tanstack/table-core' {
  // eslint-disable-next-line unused-imports/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue>
    extends MosaicDataTableColumnDefMetaOptions {}
}
