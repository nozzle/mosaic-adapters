import { seedInitialTableState } from '../../utils';

import type {
  MosaicDataTableOptions,
  MosaicDataTableStore,
  PrimitiveSqlValue,
} from '../../types';
import type { ExpandedState, RowData } from '@tanstack/table-core';

export function createInitialGroupedState<
  TData extends RowData,
  TValue extends PrimitiveSqlValue = PrimitiveSqlValue,
>(): MosaicDataTableStore<TData, TValue>['_grouped'] {
  return {
    expanded: {} as ExpandedState,
    loadingGroupIds: [],
    totalRootRows: 0,
    isRootLoading: false,
  };
}

export function createInitialDataTableStore<
  TData extends RowData,
  TValue extends PrimitiveSqlValue = PrimitiveSqlValue,
>(
  options: MosaicDataTableOptions<TData, TValue>,
): MosaicDataTableStore<TData, TValue> {
  return {
    tableState: seedInitialTableState<TData>(
      options.tableOptions?.initialState,
    ),
    tableOptions: {
      ...(options.tableOptions ?? {}),
    } as MosaicDataTableStore<TData, TValue>['tableOptions'],
    rows: [],
    pinnedRows: {
      top: [],
      bottom: [],
    },
    totalRows: undefined,
    columnDefs: options.columns ?? [],
    _facetsUpdateCount: 0,
    _grouped: createInitialGroupedState<TData, TValue>(),
  };
}
