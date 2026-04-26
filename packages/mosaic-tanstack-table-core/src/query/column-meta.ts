import type { RowData } from '@tanstack/table-core';
import type { MosaicColumnDef, MosaicColumnMeta } from '../types';

export function readMosaicColumnMeta<TData extends RowData, TValue = unknown>(
  columnDef: MosaicColumnDef<TData, TValue>,
): MosaicColumnMeta<TValue> {
  return {
    ...columnDef.meta?.mosaicDataTable,
    ...columnDef.meta?.mosaic,
  };
}
