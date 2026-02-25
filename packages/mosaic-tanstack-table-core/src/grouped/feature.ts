import type { Row, RowData, Table, TableFeature } from '@tanstack/table-core';
import type { MosaicDataTable } from '../data-table';
import type { PrimitiveSqlValue } from '../types';
import type { FlatGroupedRow, GroupMeta } from './types';

function getGroupMetaFromRow<TData extends RowData>(
  row: Row<TData>,
): GroupMeta | null {
  const original = row.original as unknown as Partial<FlatGroupedRow> | null;
  if (!original || typeof original !== 'object') {
    return null;
  }
  const meta = original._groupMeta;
  if (!meta || typeof meta !== 'object') {
    return null;
  }
  return meta;
}

export const createGroupedTableFeature = <
  TData extends RowData,
  TValue extends PrimitiveSqlValue = PrimitiveSqlValue,
>(
  client: MosaicDataTable<TData, TValue>,
): TableFeature<TData> => {
  return {
    createTable: (table: Table<TData>) => {
      Object.assign(table, {
        getIsGroupedMode: () => client.isGroupedMode,
        getGroupedState: () => client.groupedState,
        isGroupedRowLoading: (rowId: string) => client.isRowLoading(rowId),
      });
    },
    createRow: (row: Row<TData>) => {
      Object.assign(row, {
        getGroupMeta: () => getGroupMetaFromRow(row),
        getIsGroupedRow: () => {
          const meta = getGroupMetaFromRow(row);
          if (!meta) {
            return false;
          }
          return meta.type === 'group';
        },
        getIsLeafRow: () => {
          const meta = getGroupMetaFromRow(row);
          if (!meta) {
            return false;
          }
          return meta.type === 'leaf';
        },
        getGroupId: () => {
          const meta = getGroupMetaFromRow(row);
          if (!meta) {
            return null;
          }
          return meta.id;
        },
        getGroupDepth: () => {
          const meta = getGroupMetaFromRow(row);
          if (!meta) {
            return null;
          }
          return meta.depth;
        },
        getGroupValue: () => {
          const meta = getGroupMetaFromRow(row);
          if (!meta || meta.type !== 'group') {
            return null;
          }
          return meta.groupValue ?? null;
        },
        getGroupParentConstraints: () => {
          const meta = getGroupMetaFromRow(row);
          if (!meta) {
            return null;
          }
          return meta.parentConstraints;
        },
        getIsLeafParent: () => {
          const meta = getGroupMetaFromRow(row);
          if (!meta) {
            return false;
          }
          return meta.isLeafParent === true;
        },
      });
    },
  };
};
