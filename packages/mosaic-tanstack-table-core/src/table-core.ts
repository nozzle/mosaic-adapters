/* eslint-disable unused-imports/no-unused-vars */
/**
 * Module augmentation for TanStack Table to support Mosaic-specific metadata.
 * Extends the ColumnMeta interface to include configuration for SQL column mapping,
 * filtering strategies, and faceting modes.
 */
import type { RowData } from '@tanstack/table-core';
import type {
  MosaicDataTableColumnDefMetaOptions,
  MosaicDataTableStore,
  PrimitiveSqlValue,
} from './types';
import type { MosaicDataTable } from './data-table';
import type { GroupMeta } from './grouped/types';
import type { FacetStrategyKeyWithoutInput } from './registry';

declare module '@tanstack/table-core' {
  // Extend the Table Instance with the first-class Mosaic API
  interface Table<TData extends RowData> {
    mosaicDataTable: {
      requestFacet: (
        columnId: string,
        type: FacetStrategyKeyWithoutInput,
      ) => void;
      requestTotalCount: () => void;
      client: MosaicDataTable<TData, PrimitiveSqlValue>;
    };
    getIsGroupedMode: () => boolean;
    getGroupedState: () => MosaicDataTableStore<
      TData,
      PrimitiveSqlValue
    >['_grouped'];
    isGroupedRowLoading: (rowId: string) => boolean;
  }

  interface Row<TData extends RowData> {
    getGroupMeta: () => GroupMeta | null;
    getIsGroupedRow: () => boolean;
    getIsLeafRow: () => boolean;
    getGroupId: () => string | null;
    getGroupDepth: () => number | null;
    getGroupValue: () => string | null;
    getGroupParentConstraints: () => Record<string, string> | null;
    getIsLeafParent: () => boolean;
  }

  interface ColumnMeta<
    TData extends RowData,
    TValue,
  > extends MosaicDataTableColumnDefMetaOptions<TValue> {}
}

export type MosaicTableCoreAugmentation = {
  __brand: 'mosaic-table-core-augmentation';
};

export const __mosaicTableCoreAugmentation = true;
