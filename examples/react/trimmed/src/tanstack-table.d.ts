import '@tanstack/react-table';
import type { MosaicDataTableColumnDefMetaOptions } from './useMosaicReactTable';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue>
    extends MosaicDataTableColumnDefMetaOptions {
    filterVariant?: 'text' | 'range' | 'select';
  }
}
