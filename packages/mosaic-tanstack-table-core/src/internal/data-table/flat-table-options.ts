import { getCoreRowModel, getFacetedRowModel } from '@tanstack/table-core';
import { logger } from '../../logger';
import { createGroupedTableFeature } from '../../grouped/feature';
import { createMosaicFeature } from '../../feature';
import { functionalUpdate } from '../../utils';
import { getFlatTableStateChanges } from './flat-table-state';

import type { MosaicSelectionManager } from '../../selection-manager';
import type { MosaicDataTable } from '../../data-table';
import type { MosaicDataTableStore, PrimitiveSqlValue } from '../../types';
import type {
  ColumnDef,
  RowData,
  TableOptions,
  Updater,
} from '@tanstack/table-core';

function resolveFlatColumns<
  TData extends RowData,
  TValue extends PrimitiveSqlValue = PrimitiveSqlValue,
>(
  state: MosaicDataTableStore<TData, TValue>,
  schema: Array<{ column: string }>,
): Array<ColumnDef<TData, TValue>> {
  if (state.columnDefs.length > 0) {
    return state.columnDefs.map((column) => {
      return column satisfies ColumnDef<TData, TValue>;
    });
  }

  return schema.map((field) => {
    return {
      accessorKey: field.column,
      header: field.column,
    } satisfies ColumnDef<TData, TValue>;
  });
}

function runConfiguredTableStateEffect<
  TData extends RowData,
  TValue extends PrimitiveSqlValue = PrimitiveSqlValue,
>(
  client: MosaicDataTable<TData, TValue>,
  mode: 'requestQuery' | 'requestUpdate',
) {
  if (mode === 'requestQuery') {
    client.requestQuery();
    return;
  }

  client.requestUpdate();
}

export function createFlatTableOptions<
  TData extends RowData,
  TValue extends PrimitiveSqlValue = PrimitiveSqlValue,
>(params: {
  client: MosaicDataTable<TData, TValue>;
  state: MosaicDataTableStore<TData, TValue>;
  schema: Array<{ column: string }>;
  rowSelectionManager?: MosaicSelectionManager<string | number>;
  onTableStateChange: 'requestQuery' | 'requestUpdate';
}): TableOptions<TData> {
  const { client, state, schema, rowSelectionManager, onTableStateChange } =
    params;

  return {
    data: state.rows,
    columns: resolveFlatColumns(state, schema),
    getCoreRowModel: getCoreRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: client.getFacetedUniqueValues(),
    getFacetedMinMaxValues: client.getFacetedMinMaxValues(),
    state: state.tableState,
    onStateChange: (updater: Updater<typeof state.tableState>) => {
      const previousState = client.store.state.tableState;
      const nextState = functionalUpdate(updater, previousState);
      const changes = getFlatTableStateChanges(previousState, nextState);

      if (!changes.filtersChanged && typeof updater === 'function') {
        logger.debug(
          'Core',
          `[MosaicDataTable] State update received but ignored. Input might have been rejected by Table Core.`,
          {
            prevFilters: previousState.columnFilters,
            newFilters: nextState.columnFilters,
          },
        );
      }

      logger.info('TanStack-Table', 'State Change', {
        id: client.id,
        newState: {
          pagination: nextState.pagination,
          sorting: nextState.sorting,
          filters: nextState.columnFilters,
        },
      });

      client.store.setState((previousStore) => ({
        ...previousStore,
        tableState: nextState,
      }));

      if (!changes.hasAnyChange) {
        return;
      }

      if (changes.filtersChanged) {
        client.sidecarManager.refreshAll();
      }

      runConfiguredTableStateEffect(client, onTableStateChange);
    },
    onRowSelectionChange: (updaterOrValue) => {
      const previousSelection = client.store.state.tableState.rowSelection;
      const nextSelection = functionalUpdate(updaterOrValue, previousSelection);

      client.store.setState((previousStore) => ({
        ...previousStore,
        tableState: {
          ...previousStore.tableState,
          rowSelection: nextSelection,
        },
      }));

      if (!rowSelectionManager) {
        return;
      }

      const selectedValues = Object.keys(nextSelection);
      const valueToSend = selectedValues.length > 0 ? selectedValues : null;
      rowSelectionManager.select(valueToSend);
    },
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount: state.totalRows,
    ...state.tableOptions,
    _features: [
      ...(Array.isArray(state.tableOptions._features)
        ? state.tableOptions._features
        : []),
      createMosaicFeature(client),
      createGroupedTableFeature(client),
    ],
  };
}
