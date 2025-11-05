import { MosaicClient } from '@uwdata/mosaic-core';
import { getCoreRowModel } from '@tanstack/table-core';
import { Store, batch } from '@tanstack/store';
import type { Coordinator, Selection } from '@uwdata/mosaic-core';
import type { ColumnDef, TableOptions, TableState } from '@tanstack/table-core';

/**
 * let client = new DataTable({
		table,
		schema: empty.schema,
		height: options.height,
	});
	options.coordinator.connect(client);
 */

export interface MosaicDataTableOptions {
  filterBy?: Selection | undefined;
}

export type MosaicQueryMethodArg = Parameters<MosaicClient['query']>[0];
export type MosaicQueryMethodReturn = ReturnType<MosaicClient['query']>;

export type MosaicDataTableRow = {
  id: string;
  name: string;
};

export type MosaicDataTableStore = {
  demoState: { foo: string };
  tableState: TableState;
  rows: Array<MosaicDataTableRow>;
};

export function createMosaicDataTableClient(
  tableName: string,
  coordinator: Coordinator,
  options?: MosaicDataTableOptions,
) {
  const client = new MosaicDataTable(tableName, options);

  coordinator.connect(client);

  return client;
}

export class MosaicDataTable extends MosaicClient {
  dataTableName = '';
  #store: Store<MosaicDataTableStore>;

  constructor(tableName: string, options?: MosaicDataTableOptions) {
    super(options?.filterBy); // pass appropriate filterSelection if needed
    if (!tableName) {
      throw new Error('[MosaicDataTable] A table name must be provided.');
    }

    this.dataTableName = tableName;

    this.#store = new Store(
      {
        demoState: { foo: 'bar' },
        tableState: seedInitialTableState(),
        rows: [
          {
            id: '1',
            name: 'Alice',
          },
        ] satisfies MosaicDataTableStore['rows'],
      },
      {
        onUpdate: () => {},
      },
    );
  }

  // override query(filter?: MosaicQueryMethodArg): MosaicQueryMethodReturn {
  //   // Implement query logic specific to the data table
  //   return undefined as any;
  // }

  /**
   * Get the TanStack Table options to be used with the framework adapters.
   */
  getTableOptions(
    state: Store<MosaicDataTableStore>['state'],
  ): TableOptions<unknown> {
    const columns = [
      {
        accessorKey: 'id',
      },
      {
        accessorKey: 'name',
      },
    ] satisfies Array<ColumnDef<MosaicDataTableRow>>;

    return {
      data: state.rows,
      columns,
      getCoreRowModel: getCoreRowModel(),
      state: state.tableState,
      onStateChange: (updater) => {
        const tableState = functionalUpdate(
          updater,
          this.#store.state.tableState,
        );

        this.#store.setState((prev) => ({
          ...prev,
          tableState,
        }));
      },
      manualPagination: true,
    };
  }

  addRow(name: string): void {
    const newId = (this.#store.state.rows.length + 1).toString();
    const newRow = { id: newId, name };

    batch(() => {
      this.#store.setState((prev) => ({
        ...prev,
        rows: [...prev.rows, newRow],
      }));
    });
  }

  mutateStateTo(value: string): void {
    batch(() => {
      this.#store.setState((prev) => {
        return { ...prev, demoState: { foo: value } };
      });
    });
  }

  get store(): Store<MosaicDataTableStore> {
    return this.#store;
  }
}

function functionalUpdate<T>(updater: T | ((old: T) => T), old: T): T {
  return typeof updater === 'function'
    ? (updater as (old: T) => T)(old)
    : updater;
}

function seedInitialTableState(): TableState {
  return {
    pagination: {
      pageIndex: 0,
      pageSize: 10,
    },
    columnFilters: [],
    columnVisibility: {},
    columnOrder: [] satisfies Array<string>,
    columnPinning: {},
    rowPinning: {},
    globalFilter: '',
    sorting: [],
    expanded: {},
    grouping: [],
    columnSizing: {},
    columnSizingInfo: {
      columnSizingStart: [],
      deltaOffset: null,
      deltaPercentage: null,
      isResizingColumn: false,
      startOffset: null,
      startSize: null,
    },
    rowSelection: {},
  };
}
