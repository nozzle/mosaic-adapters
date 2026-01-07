import '@tanstack/react-table';
import type {
  FacetStrategyDefinition,
  MosaicDataTableColumnDefMetaOptions,
} from '@nozzleio/mosaic-tanstack-react-table';
import type { HistogramBin, HistogramInput } from '@/lib/strategies';

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
// We allow users to extend the functionality of the adapter (adding new strategies like histograms)
// by augmenting the Core registry interface.
//
// Even though we use the React adapter at runtime, TypeScript requires the
// definition source (`@nozzleio/mosaic-tanstack-table-core`) to be visible
// for augmentation to work. This is why table-core is listed in devDependencies.
declare module '@nozzleio/mosaic-tanstack-table-core' {
  interface MosaicFacetRegistry {
    // Updated to use the new Definition type
    histogram: FacetStrategyDefinition<HistogramInput, Array<HistogramBin>>;
  }
}
