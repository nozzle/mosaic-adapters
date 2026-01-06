// packages/mosaic-tanstack-react-table/src/utils.ts

import type { ColumnDef, RowData } from '@tanstack/react-table';

type UnwrapNullable<T> = T extends null | undefined
  ? never
  : T extends Array<infer U>
    ? U
    : T;

type FilterVariantFor<TValue> =
  UnwrapNullable<TValue> extends number
    ? 'range' | 'select'
    : UnwrapNullable<TValue> extends Date
      ? 'range' /* date range */
      : 'text' | 'select';

/**
 * Type-safe column helper factory for Mosaic Tables.
 *
 * This utility infers the `TValue` of the column based on the accessor key of `TData`.
 * It eliminates the need to manually pass `any` or strict types to `ColumnDef`.
 *
 * It also restricts `meta` options based on the inferred type of the column.
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
      def: Omit<ColumnDef<TData, TData[TKey]>, 'meta'> & {
        meta?: {
          mosaicDataTable?: {
            // Constrain the filterVariant based on TData[TKey]
            filterVariant?: FilterVariantFor<TData[TKey]>;
            // Ensure facet type matches data type (Allow minmax for Number or Date)
            facet?: UnwrapNullable<TData[TKey]> extends number | Date
              ? 'minmax' | 'unique'
              : 'unique';
            sqlColumn?: string;
          };
        } & Record<string, any>;
      } = {},
    ): ColumnDef<TData, TData[TKey]> => {
      return {
        accessorKey: key as string,
        ...def,
      } as ColumnDef<TData, TData[TKey]>;
    },
  };
}
