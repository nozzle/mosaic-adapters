import { MosaicClient } from '@uwdata/mosaic-core';
import { getCoreRowModel } from '@tanstack/table-core';
import { Store, batch } from '@tanstack/store';
import type { Coordinator, Selection } from '@uwdata/mosaic-core';
import type { TableOptions } from '@tanstack/table-core';

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

export type MosaicDataTableStore = {
  foo: string;
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
      { foo: 'bar' },
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

  mutateStateTo(value: string): void {
    batch(() => {
      this.#store.setState((prev) => {
        return { ...prev, foo: value };
      });
    });
  }

  get store(): Store<MosaicDataTableStore> {
    return this.#store;
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
  getTableStateInit(): TableOptions<unknown> {
    // Seeds the table state with initial values, plus any necessary methods
    // callbacks to update the state in framework-land
    return {
      columns: [],
      data: [],
      getCoreRowModel: getCoreRowModel(),
    };
  }
}
