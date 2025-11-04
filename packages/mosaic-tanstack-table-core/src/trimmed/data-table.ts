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

export interface DataTableOptions {
  coordinator: Coordinator;
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

export class MosaicDataTable extends MosaicClient {
  dataTableName = '';
  #store: Store<MosaicDataTableStore>;

  constructor(tableName: string, options: DataTableOptions) {
    super(options.filterBy); // pass appropriate filterSelection if needed
    if (!tableName) {
      throw new Error('[MosaicDataTable] A table name must be provided.');
    }

    this.dataTableName = tableName;

    this.#store = new Store(
      {
        demoState: { foo: 'bar' },
        tableState: {
          pagination: {
            pageIndex: 0,
            pageSize: 10,
          },
        } as any,
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

  override query(filter?: MosaicQueryMethodArg): MosaicQueryMethodReturn {
    // Implement query logic specific to the data table
    return undefined as any;
  }

  getTableInstance(tableState: unknown) {
    // Placeholder for returning the table instance
    return undefined;
  }

  getTableState() {
    // Placeholder for creating necessary TableState in framework-land
    return undefined;
  }

  /**
   * const table = useReactTable(clientInstance.getTableStateInit()) ???
   * -- Render markup using TanStack Table Instance
   *
   * - or perhaps
   *
   * const tableOptions = useMosaicDataTableClient(clientInstance);
   * const table = useReactTable(tableOptions);
   * -- Render markup using TanStack Table Instance
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
        const newState =
          typeof updater === 'function'
            ? updater(this.#store.state.tableState)
            : updater;

        this.#store.setState((prev) => ({
          ...prev,
          tableState: {
            ...prev.tableState,
            ...newState,
          },
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
