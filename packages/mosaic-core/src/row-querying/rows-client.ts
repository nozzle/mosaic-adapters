import {
  MosaicClient,
  coordinator as defaultCoordinator,
  isArrowTable,
  queryFieldInfo,
} from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { batch, createStore } from '@tanstack/store';
import type {
  Coordinator,
  FieldInfo,
  FieldInfoRequest,
  Selection,
} from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';

export type RowsQueryForResult = {
  query: SelectQuery | string | null;
  columns: Array<string> | null;
};
export type RowsQueryFor = (filter?: FilterExpr | null) => RowsQueryForResult;

export type RowsClientOptions = {
  /**
   * A callback function that generates a Mosaic SQL Query or a SQL string for the rows client based on an optional filter expression.
   * The function should return a Query object, a SQL string, or null if no query can be generated for the given filter.
   */
  query: RowsQueryFor;
  /**
   * Optional filter selection to apply to the query.
   */
  filterBy?: Selection | undefined;
  /**
   * Optional to provide a custom coordinator. If not provided, the client will use the default coordinator.
   */
  coordinator?: Coordinator | undefined;
};

export type RowsDataStore<TData> = { rows: Array<TData> };
export type RowsStateStore = { status: 'idle' | 'loading' | 'error' };

export class RowsClient<TData> extends MosaicClient {
  private _queryFn: RowsQueryFor;

  _coordinator: Coordinator | null = defaultCoordinator();
  _schema: Array<FieldInfo> = [];

  private dataStore = createStore<RowsDataStore<TData>>({ rows: [] });
  private stateStore = createStore<RowsStateStore>({ status: 'idle' });

  constructor(options: RowsClientOptions) {
    super(options.filterBy);

    this._queryFn = options.query;
    this._coordinator = options.coordinator ?? defaultCoordinator();
  }

  /**
   * Resolves a query based on whatever input Query is provided by `queryFor`. This is a separate method, since the data-type of what is passed into `queryFor` could possibly be different in the future.
   * @param filter - You pass in a filter for when you want a fully resolved query.
   */
  _resolveQuery(filter?: FilterExpr | null) {
    const result = this._queryFn(filter);
    return result.query;
  }

  /**
   * Resolves columns based on whatever input Query is provided by `queryFor`. This is a separate method, since the data-type of what is passed into `queryFor` could possibly be different in the future.
   */
  _resolveColumns() {
    const result = this._queryFn();
    return result.columns || [];
  }

  _resolveSource() {
    const result = this._queryFn();
    return result.query;
  }

  override query(queryFilter?: FilterExpr | null) {
    const baseQuery = this._resolveQuery(queryFilter);

    if (!baseQuery) {
      throw new Error(
        'No query could be resolved from the provided query function. Please ensure that your query function returns a valid query for the given filter.',
      );
    }

    const query = Query.from(baseQuery).select(this._resolveColumns());

    return query;
  }

  async prepare() {
    const table = this._resolveSource();
    const columns = this._resolveColumns();

    const field: Array<FieldInfoRequest> = columns.map((column) => ({
      column,
      table: `${table}`,
    }));

    const schema = await queryFieldInfo(this.coordinator!, field);
    this._schema = schema;
  }

  override queryResult(data: unknown): this {
    // Handle the data that's come back in Arrow format.
    if (isArrowTable(data)) {
      const arr = data.toArray();
      batch(() => {
        this.dataStore.setState(() => ({
          rows: arr as unknown as Array<TData>,
        }));
        this.stateStore.setState(() => ({ status: 'idle' }));
      });
    }

    return this;
  }
}

export function createRowsClient(options: RowsClientOptions) {
  return new RowsClient(options);
}
