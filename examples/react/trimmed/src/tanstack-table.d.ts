// examples/react/trimmed/src/tanstack-table.d.ts
import '@tanstack/react-table';
import type { MosaicDataTableColumnDefMetaOptions } from '@nozzleio/mosaic-tanstack-react-table';
import type { HistogramBin } from '@/lib/strategies';

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

// Module Augmentation for the Mosaic Registry
// This allows the core library to understand our custom 'histogram' strategy
declare module '@nozzleio/mosaic-tanstack-table-core' {
  interface MosaicFacetRegistry {
    histogram: {
      input: { binSize: number };
      output: Array<HistogramBin>;
    };
  }
}
