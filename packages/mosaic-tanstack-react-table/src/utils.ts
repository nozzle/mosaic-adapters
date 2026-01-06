// packages/mosaic-tanstack-react-table/src/utils.ts

import type { ColumnDef, RowData } from '@tanstack/react-table';

/**
 * Type-safe column helper factory for Mosaic Tables.
 *
 * This utility infers the `TValue` of the column based on the accessor key of `TData`.
 * It eliminates the need to manually pass `any` or strict types to `ColumnDef`.
 *
 * @example
 * const helper = createMosaicColumnHelper<User>();
 * const columns = [
 *   helper.accessor('name', { header: 'Full Name' }),
 *   helper.accessor('age', { header: 'Age', cell: info => info.getValue().toFixed(0) }) // getValue() is number
 * ];
 */
export function createMosaicColumnHelper<TData extends RowData>() {
  return {
    accessor: <TKey extends keyof TData>(
      key: TKey,
      // TData[TKey] is inferred as the value type
      def: Partial<ColumnDef<TData, TData[TKey]>> = {},
    ): ColumnDef<TData, TData[TKey]> => {
      return {
        accessorKey: key as string,
        ...def,
      } as ColumnDef<TData, TData[TKey]>;
    },
  };
}
