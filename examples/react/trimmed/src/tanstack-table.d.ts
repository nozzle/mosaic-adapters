import '@tanstack/react-table';
import type { MosaicDataTableColumnDefMetaOptions } from '@nozzleio/mosaic-tanstack-react-table';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue>
    extends MosaicDataTableColumnDefMetaOptions {
    filterVariant?: 'text' | 'range' | 'select';
    // Added 'datetime' to the allowed types
    rangeFilterType?: 'number' | 'date' | 'datetime';
  }
}
