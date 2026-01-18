import '@tanstack/react-table';
import type { RowData } from '@tanstack/react-table';
import type {
  MosaicDataTable,
  MosaicDataTableColumnDefMetaOptions,
} from '@nozzleio/mosaic-tanstack-react-table';

// Module Augmentation for TanStack Table
// This extends the core TanStack definitions to support Mosaic-specific metadata
// required for filter variants, facet types, and SQL column mapping.
declare module '@tanstack/react-table' {
  interface ColumnMeta<
    TData extends RowData,
    TValue,
  > extends MosaicDataTableColumnDefMetaOptions<TValue> {
    filterVariant?: 'text' | 'range' | 'select';
    rangeFilterType?: 'number' | 'date' | 'datetime';
  }

  interface Table<TData extends RowData> {
    mosaicDataTable: {
      requestFacet: (columnId: string, type: string) => void;
      requestTotalCount: () => void;
      client: MosaicDataTable<TData, any>;
    };
  }
}
