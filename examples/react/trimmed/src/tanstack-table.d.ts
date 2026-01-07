import '@tanstack/react-table';
import type { MosaicDataTableColumnDefMetaOptions } from '@nozzleio/mosaic-tanstack-react-table';

// Module Augmentation for TanStack Table
// This extends the core TanStack definitions to support Mosaic-specific metadata
// required for filter variants, facet types, and SQL column mapping.
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue>
    extends MosaicDataTableColumnDefMetaOptions {
    filterVariant?: 'text' | 'range' | 'select';
    rangeFilterType?: 'number' | 'date' | 'datetime';
  }

  interface TableMeta<TData extends RowData> {
    selectedValue?: any;
  }
}
