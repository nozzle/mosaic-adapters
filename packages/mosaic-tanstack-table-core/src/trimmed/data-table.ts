// packages/mosaic-tanstack-table-core/src/trimmed/data-table.ts
// Core logic for the MosaicDataTable client, bridging Mosaic data queries with TanStack Table state.
import {
  MosaicClient,
  coordinator as defaultCoordinator,
  isArrowTable,
  isParam,
  queryFieldInfo,
} from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { getCoreRowModel, getFacetedRowModel } from '@tanstack/table-core';
import { Store, batch } from '@tanstack/store';
import {
  functionalUpdate,
  seedInitialTableState,
  toSafeSqlColumnName,
} from './utils';
import { logger } from './logger';

import type {
  Coordinator,
  FieldInfo,
  FieldInfoRequest,
  Param,
  Selection,
  SelectionClause,
} from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  ColumnDef,
  RowData,
  Table,
  TableOptions,
} from '@tanstack/table-core';
import type { MosaicDataTableOptions, MosaicDataTableStore } from './types';

/**
 * This is a factory function to create a MosaicDataTable client.
 *
 * @typeParam `TData` The row data type used in TanStack Table.
 * @typeParam `TValue` The cell value type used in TanStack Table.
 * @param options Options to be passed into the constructor of the MosaicDataTable.
 * @returns A new instance of the MosaicDataTable client.
 */
export function createMosaicDataTableClient<
  TData extends RowData,
  TValue = unknown,
>(options: MosaicDataTableOptions<TData, TValue>) {
  // Initialize the table client
  const client = new MosaicDataTable<TData, TValue>(options);
  return client;
}

/**
 * A Mosaic Client that does the glue work to drive TanStack Table, using it's
 * TableOptions for configuration.
 */
export class MosaicDataTable<
  TData extends RowData,
  TValue = unknown,
> extends MosaicClient {
  from: Param<string> | string;
  schema: Array<FieldInfo> = [];
  internalFilter?: Selection;

  facets: Map<string, any> = new Map();

  #store!: Store<MosaicDataTableStore<TData, TValue>>;
  #sql_total_rows = toSafeSqlColumnName('__total_rows');
  #onTableStateChange: 'requestQuery' | 'requestUpdate' = 'requestUpdate';

  #columnDefIdToSqlColumnAccessor: Map<string, string> = new Map();
  #columnDefIdToFieldInfo: Map<string, FieldInfo> = new Map();
  #sqlColumnAccessorToFieldInfo: Map<string, FieldInfo> = new Map();

  constructor(options: MosaicDataTableOptions<TData, TValue>) {
    super(options.filterBy); // pass the appropriate Filter Selection

    this.from = options.table;
    this.internalFilter = options.internalFilter;

    if (!this.sourceTable()) {
      throw new Error('[MosaicDataTable] A table name must be provided.');
    }

    this.updateOptions(options);
  }

  /**
   * When options are updated from framework-land, we need to update
   * the internal store and state accordingly.
   * @param options The updated options from framework-land.
   */
  updateOptions(options: MosaicDataTableOptions<TData, TValue>): void {
    logger.debug('Core', 'updateOptions received', {
      newTable: options.table,
      columnsCount: options.columns?.length,
    });

    if (options.onTableStateChange) {
      this.#onTableStateChange = options.onTableStateChange;
    }

    if (options.internalFilter) {
      this.internalFilter = options.internalFilter;
    }

    // Ensure we have a coordinator assigned
    if (!this.coordinator) {
      const coordinatorInstance = options.coordinator ?? defaultCoordinator();
      this.coordinator = coordinatorInstance;
    }

    type ResolvedStore = MosaicDataTableStore<TData, TValue>;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!this.#store) {
      this.#store = new Store({
        tableState: seedInitialTableState<TData>(
          options.tableOptions?.initialState,
        ),
        tableOptions: {
          ...(options.tableOptions ?? {}),
        } as ResolvedStore['tableOptions'],
        rows: [] as ResolvedStore['rows'],
        totalRows: undefined as ResolvedStore['totalRows'],
        columnDefs: options.columns ?? ([] as ResolvedStore['columnDefs']),
      });
    } else {
      this.#store.setState((prev) => ({
        ...prev,
        columnDefs:
          options.columns !== undefined ? options.columns : prev.columnDefs,
      }));
    }
  }

  override query(primaryFilter?: FilterExpr | null | undefined): SelectQuery {
    const tableName = this.sourceTable();

    const tableState = this.#store.state.tableState;

    const pagination = tableState.pagination;

    // Only consider sorting for columns that can be mapped to Mosaic columns
    const sorting = tableState.sorting.filter((sort) =>
      this.#columnDefIdToSqlColumnAccessor.has(sort.id),
    );

    // Only consider column filters for columns that can be mapped to Mosaic columns
    const columnFilters = tableState.columnFilters.filter((filter) =>
      this.#columnDefIdToSqlColumnAccessor.has(filter.id),
    );

    // Get the Table SQL columns to select
    const tableColumns = this.sqlColumns();

    // Initialize the main query statement
    // This is where the actual main Columns with Pagination will be applied
    const statement = mSql.Query.from(tableName).select(...tableColumns, {
      [this.#sql_total_rows]: mSql.sql`COUNT(*) OVER()`, // Window function to get total rows
    });

    const whereClauses: Array<mSql.FilterExpr> = [];

    // Conditionally add the primary filter
    if (primaryFilter) {
      whereClauses.push(primaryFilter);
    }

    // Add column filters
    const internalClauses: Array<mSql.FilterExpr> = [];

    columnFilters.forEach((columnFilter) => {
      const columnAccessor = this.#columnDefIdToSqlColumnAccessor.get(
        columnFilter.id,
      )!;
      // Assertion is safe due to filtering above

      // Find the Column Definition to check for metadata
      const colDef = this.#store.state.columnDefs.find(
        (c) => c.id === columnFilter.id,
      );

      const filterType =
        colDef?.meta?.mosaicDataTable?.sqlFilterType ?? 'equals';

      let clause: mSql.FilterExpr | undefined;

      if (filterType === 'range' && Array.isArray(columnFilter.value)) {
        // Range Filter (BETWEEN, >=, or <=)
        const [rawMin, rawMax] = columnFilter.value as [unknown, unknown];

        // HTML Inputs return strings, even for type="number".
        // We must safely parse these, treating empty strings or nulls as missing values.
        const min =
          rawMin !== '' && rawMin !== null && rawMin !== undefined
            ? Number(rawMin)
            : NaN;
        const max =
          rawMax !== '' && rawMax !== null && rawMax !== undefined
            ? Number(rawMax)
            : NaN;

        const hasMin = !Number.isNaN(min);
        const hasMax = !Number.isNaN(max);

        if (hasMin && hasMax) {
          clause = mSql.sql`${columnAccessor} BETWEEN ${min} AND ${max}`;
        } else if (hasMin) {
          clause = mSql.gte(columnAccessor, mSql.literal(min));
        } else if (hasMax) {
          clause = mSql.lte(columnAccessor, mSql.literal(max));
        }
      } else if (
        filterType === 'ilike' &&
        typeof columnFilter.value === 'string'
      ) {
        // ILIKE Filter (Contains)
        // We wrap the value in wildcards to ensure it acts as a "Contains" search
        const val = columnFilter.value.trim();
        if (val) {
          clause = mSql.sql`${columnAccessor} ILIKE ${mSql.literal('%' + val + '%')}`;
        }
      } else if (filterType === 'equals') {
        // Direct equality (useful for Selects / Dropdowns)
        if (columnFilter.value !== '') {
          clause = mSql.eq(columnAccessor, mSql.literal(columnFilter.value));
        }
      } else {
        // Fallback default: assume string search
        if (typeof columnFilter.value === 'string') {
          const val = columnFilter.value.trim();
          if (val) {
            clause = mSql.sql`${columnAccessor} ILIKE ${mSql.literal('%' + val + '%')}`;
          }
        }
      }

      if (clause) {
        whereClauses.push(clause);
        internalClauses.push(clause);
      }
    });

    // Update Internal Filter Selection
    // This allows bidirectional filtering (Table -> Charts)
    if (this.internalFilter) {
      const predicate =
        internalClauses.length > 0 ? mSql.and(...internalClauses) : null;

      this.internalFilter.update({
        source: this,
        value: tableState.columnFilters,
        predicate: predicate,
      });
    }

    // Apply all where clauses to the Table Query
    statement.where(...whereClauses);

    // Add sorting
    const orderingCriteria: Array<mSql.OrderByNode> = [];
    sorting.forEach((sort) => {
      const columnAccessor = this.#columnDefIdToSqlColumnAccessor.get(sort.id)!;

      // Build the sorting command based on direction
      orderingCriteria.push(
        sort.desc ? mSql.desc(columnAccessor) : mSql.asc(columnAccessor),
      );
    });

    // Apply ordering criteria
    statement.orderby(...orderingCriteria);

    // Add offset and limit based pagination
    statement
      .limit(pagination.pageSize)
      .offset(pagination.pageIndex * pagination.pageSize);

    logger.debounce('sql-query', 300, 'info', 'SQL', 'Generated Query', {
      sql: statement.toString(),
      context: {
        pagination: tableState.pagination,
        sorting: tableState.sorting,
        columnFilters: tableState.columnFilters,
      },
    });

    return statement;
  }

  override queryPending(): this {
    return this;
  }

  override queryError(error: Error): this {
    logger.error('Core', 'Query Error', { error });
    return this;
  }

  override queryResult(table: unknown): this {
    if (isArrowTable(table)) {
      let totalRows: number | undefined = undefined;

      // Convert Arrow Table to rows array for TanStack Table
      const rows = table.toArray() as Array<TData>;

      // Check for the total rows column identifier, and pull out the value if present
      // We only need to check the first row since it's the same value for all rows
      if (
        rows.length > 0 &&
        rows[0] &&
        typeof rows[0] === 'object' &&
        this.#sql_total_rows in rows[0]
      ) {
        const firstRow = rows[0] as Record<string, any>;
        totalRows = firstRow[this.#sql_total_rows];
      }

      batch(() => {
        this.#store.setState((prev) => {
          return {
            ...prev,
            rows,
            totalRows,
          };
        });
      });
    } else {
      logger.error('Core', 'Received non-Arrow result:', { table });
    }

    return this;
  }

  override async prepare(): Promise<void> {
    const schema = await queryFieldInfo(this.coordinator!, this.fields());
    this.schema = schema;

    // Clear previous mappings
    this.#columnDefIdToFieldInfo.clear();
    this.#sqlColumnAccessorToFieldInfo.clear();

    // Build a map of SQL Column name to FieldInfo for performant lookup
    const map = new Map<string, FieldInfo>();
    schema.forEach((field) => {
      map.set(field.column, field);
    });

    this.#sqlColumnAccessorToFieldInfo = map;

    // Map ColumnDef IDs to FieldInfo
    Array.from(this.#columnDefIdToSqlColumnAccessor.entries()).forEach(
      ([id, value]) => {
        const matchedField = map.get(value);
        if (!matchedField) {
          logger.warn(
            'Core',
            `[MosaicDataTable] Column definition with id "${id}" has an accessorKey or mosaicDataTable.sqlColumn "${value}" that does not exist in the table schema.`,
          );
        } else {
          this.#columnDefIdToFieldInfo.set(id, matchedField);
        }
      },
    );

    return Promise.resolve();
  }

  connect(): () => void {
    // Connect to the coordinator
    // so that it can also start piping data from Mosaic to the table
    this.coordinator?.connect(this);

    // Mark the client as enabled, so that it can start requesting queries
    // and processing results. This process happens internally in MosaicClient,
    // when the `enabled` setter is called.
    this.enabled = true;

    // Bind and return the destroy function
    // so that Mosaic do its cleanup properly
    const destroy = this.destroy.bind(this);

    // Setup the primary selection change listener to reset pagination
    const selectionCb = (_: Array<SelectionClause> | undefined) => {
      batch(() => {
        // When the selection changes, we reset pagination to the first page
        this.#store.setState((prev) => ({
          ...prev,
          tableState: {
            ...prev.tableState,
            pagination: {
              ...prev.tableState.pagination,
              pageIndex: 0,
            },
          },
        }));
      });
    };
    this.filterBy?.addEventListener('value', selectionCb);

    return () => {
      // Remove the primary selection change listener
      this.filterBy?.removeEventListener('value', selectionCb);

      // Cleanup and perform destroy operations
      destroy();
    };
  }

  destroy(): void {
    super.destroy();
  }

  // --- Faceting Support ---

  /**
   * Loads unique values for a specific column (for Select dropdowns).
   * Respects the external `filterBy` selection (so dropdowns update when charts are brushed).
   */
  loadColumnFacet(columnId: string) {
    const sqlColumn = this.#columnDefIdToSqlColumnAccessor.get(columnId);
    if (!sqlColumn) return;

    // Use a helper client to fetch unique values
    const facetClient = new UniqueColumnValuesClient({
      table: this.sourceTable(),
      column: sqlColumn,
      filterBy: this.filterBy, // Listen to global filters
      coordinator: this.coordinator,
      onResult: (values) => {
        this.facets.set(columnId, values);
        // Trigger a state update so React re-renders the dropdowns
        batch(() => {
          this.#store.setState((prev) => ({ ...prev }));
        });
      },
    });

    facetClient.requestUpdate();
  }

  /**
   * Loads Min/Max values for a column (for Range Sliders).
   */
  loadColumnMinMax(columnId: string) {
    const sqlColumn = this.#columnDefIdToSqlColumnAccessor.get(columnId);
    if (!sqlColumn) return;

    // We create a temporary query just to fetch this one metric
    const query = mSql.Query.from(this.sourceTable()).select({
      min: mSql.min(sqlColumn),
      max: mSql.max(sqlColumn),
    });

    this.coordinator?.exec(query).then((result) => {
      if (isArrowTable(result)) {
        const row = result.toArray()[0] as any;
        // TanStack expects [min, max]
        const minMax = [row.min, row.max];

        this.facets.set(columnId, minMax);

        batch(() => {
          this.#store.setState((prev) => ({ ...prev }));
        });
      }
    });
  }

  // --- Core Helpers ---

  /**
   * Helper utility to build the SQL select columns,
   * taking into account any column remaps defined
   * and other TanStack Table ColumnDef options.
   */
  private sqlColumns(): Array<mSql.SelectExpr> {
    // Get the columns to select in SQL-land
    const selectColumns = this.fields().map((d) =>
      typeof d.column !== 'string' ? d.column.toString() : d.column,
    );

    return [selectColumns];
  }

  /**
   * Resolve the table name based on the constructor options.
   * This is mostly useful if the table name is a Mosaic Param,
   * then it will return the resolved value.
   */
  sourceTable(): string {
    return (isParam(this.from) ? this.from.value : this.from) as string;
  }

  /**
   * This function validates the ColumnDefs provided to the MosaicDataTable,
   * ensuring that they can be mapped to Mosaic columns for querying.
   *
   * Additionally, this functions builds up any necessary internal metadata
   * needed to drive the query generation and resolution.
   */
  private getColumnsDefs() {
    const columnDefs = this.#store.state.columnDefs;

    // Clear previous mappings
    this.#columnDefIdToSqlColumnAccessor.clear();

    // We should only consider columns that can be mapped to Mosaic columns
    const queryableColumns = columnDefs.filter((def) => {
      // If the column has an accessorKey, we can use that
      if (
        'accessorKey' in def &&
        typeof def.accessorKey === 'string' &&
        def.accessorKey.length > 0
      ) {
        return true;
      }

      // If the column has an accessorFn, we can use that
      if ('accessorFn' in def && typeof def.accessorFn === 'function') {
        return true;
      }

      // Otherwise, we cannot map this column to a Mosaic column
      return false;
    });

    let shouldSearchAllColumns = queryableColumns.length === 0;

    let columnAccessorKeys: Array<string> = [];

    // Validate each ColumnDef, by running through them and checking
    // These are considered to be MosaicColumns, so this validation pass is required.
    queryableColumns.forEach((def) => {
      let columnAccessor: string | undefined = undefined;
      // When using an accessorKey, we can directly map that to a Mosaic column.
      if ('accessorKey' in def && def.accessorKey) {
        const accessor =
          typeof def.accessorKey === 'string'
            ? def.accessorKey
            : def.accessorKey.toString();

        // If the user has provided `mosaicColumn` metadata, we need to ensure
        // that it matches the accessorKey, otherwise we warn them that accessorKey
        // will be used instead.
        if (
          def.meta !== undefined &&
          def.meta.mosaicDataTable !== undefined &&
          def.meta.mosaicDataTable.sqlColumn !== undefined &&
          def.meta.mosaicDataTable.sqlColumn !== accessor
        ) {
          logger.warn(
            'Core',
            `[MosaicDataTable] Column definition accessorKey "${accessor}" does not match the provided mosaicDataTable.sqlColumn "${def.meta.mosaicDataTable.sqlColumn}". The accessorKey will be used for querying in SQL-land.`,
            { def },
          );
        }
        def.meta;

        columnAccessorKeys.push(accessor);
        columnAccessor = accessor;
      } else if ('accessorFn' in def && typeof def.accessorFn === 'function') {
        // When using an accessorFn, things change a bit since we don't know the resulting column
        // unless the user has provided the `mosaicColumn` metadata.
        if (
          def.meta !== undefined &&
          def.meta.mosaicDataTable !== undefined &&
          def.meta.mosaicDataTable.sqlColumn !== undefined
        ) {
          const mosaicColumn = def.meta.mosaicDataTable.sqlColumn;

          columnAccessorKeys.push(mosaicColumn);
          columnAccessor = mosaicColumn;
        } else {
          shouldSearchAllColumns = true;
          logger.warn(
            'Core',
            `[MosaicDataTable] Column definition using \`accessorFn\` is missing required \`mosaicDataTable.sqlColumn\` metadata.`,
            {
              def,
              hint: `Without this, the resulting query will need to return all columns to try and satisfy the accessor function.`,
            },
          );
          return;
        }
      }

      if (!columnAccessor) {
        const message = `[MosaicDataTable] Column definition is missing an \`accessorKey\` or valid \`mosaicDataTable.sqlColumn\` metadata to map to a Mosaic Query column. Please provide one of these properties.`;
        logger.error('Core', message, { def });
        throw new Error(message);
      }

      // Make sure we have a valid ID for the column
      if (!def.id) {
        const message = `[MosaicDataTable] Column definition is missing an \`id\` property and could not be inferred. Please provide an explicit \`id\` or use \`accessorKey\`.`;
        logger.error('Core', message, { def });
        throw new Error(message);
      }

      // Store the mapping of ColumnDef ID to Mosaic column accessor
      this.#columnDefIdToSqlColumnAccessor.set(def.id, columnAccessor);
    });

    if (shouldSearchAllColumns) {
      columnAccessorKeys = [];
    }

    return {
      columnDefs: queryableColumns,
      columnAccessorKeys,
      shouldSearchAllColumns,
    };
  }

  /**
   * Map TanStack Table's ColumnDefs to Mosaic FieldInfoRequests
   * to be used in queries.
   */
  fields(): Array<FieldInfoRequest> {
    const table = this.sourceTable();

    const result = this.getColumnsDefs();
    const { shouldSearchAllColumns, columnAccessorKeys } = result;

    return shouldSearchAllColumns
      ? [
          {
            table,
            column: '*', // This means "all columns" in Mosaic SQL
          },
        ]
      : columnAccessorKeys.map((accessor) => {
          return {
            table,
            column: accessor,
          };
        });
  }

  /**
   * Map the MosaicDataTableStore state to TanStack TableOptions,
   * with the necessary callbacks to handle state changes and re-querying
   * from Mosaic.
   *
   * @param state The MosaicDataTableStore state from framework-land.
   * @returns Valid TanStack TableOptions for driving a TanStack Table instance in framework-land.
   */
  getTableOptions(
    state: Store<MosaicDataTableStore<TData, TValue>>['state'],
  ): TableOptions<TData> {
    const columns =
      state.columnDefs.length === 0
        ? // No ColDefs were provided, so we default to all columns
          this.schema.map((field) => {
            return {
              accessorKey: field.column,
              header: field.column,
            } satisfies ColumnDef<TData, TValue>;
          })
        : state.columnDefs.map((column) => {
            return column satisfies ColumnDef<TData, TValue>;
          });

    return {
      data: state.rows,
      columns,
      getCoreRowModel: getCoreRowModel(),
      getFacetedRowModel: getFacetedRowModel(),
      getFacetedUniqueValues: this.getFacetedUniqueValues(),
      getFacetedMinMaxValues: this.getFacetedMinMaxValues(),
      state: state.tableState,
      onStateChange: (updater) => {
        // TODO: Add something like `ohash` for stable object hashing
        // Stored the old hashed table state to compare after update
        const hashedOldState = JSON.stringify(this.#store.state.tableState);

        const tableState = functionalUpdate(
          updater,
          this.#store.state.tableState,
        );

        this.#store.setState((prev) => ({
          ...prev,
          tableState,
        }));

        // Compare the new hashed table state to the old one to determine if we need to request a new query
        const hashedNewState = JSON.stringify(tableState);
        if (hashedOldState !== hashedNewState) {
          this[this.#onTableStateChange]();
        }
      },
      manualPagination: true,
      manualSorting: true,
      manualFiltering: true,
      rowCount: state.totalRows,
      ...state.tableOptions,
    };
  }

  /**
   * A server-side implementation of TanStack Table's
   * `getFacetedUniqueValues` function, to retrieve
   * unique values for a given column from the pre-fetched facets.
   */
  getFacetedUniqueValues<TData extends RowData>(): (
    table: Table<TData>,
    columnId: string,
  ) => () => Map<any, number> {
    return (_table, columnId) => {
      const values = this.getFacets().get(columnId);

      if (!values) {
        return () => new Map<any, number>();
      }

      if (Array.isArray(values)) {
        const map = new Map<any, number>();
        values.forEach((value) => {
          map.set(value, 1);
        });
        return () => map;
      }

      return () => new Map<any, number>();
    };
  }

  getFacetedMinMaxValues<TData extends RowData>(): (
    table: Table<TData>,
    columnId: string,
  ) => () => [any, any] | undefined {
    return (_table, columnId) => {
      const values = this.getFacets().get(columnId);
      if (Array.isArray(values) && values.length === 2) {
        return () => values as [any, any];
      }
      return () => undefined;
    };
  }

  get store(): Store<MosaicDataTableStore<TData, TValue>> {
    return this.#store;
  }

  getFacets(): Map<string, any> {
    return this.facets;
  }
}

/**
 * This is a helper Mosaic Client to query unique values for a given column
 * in a table. This is useful for faceting operations.
 */
export class UniqueColumnValuesClient extends MosaicClient {
  from: string;
  column: string;
  onResult: (values: Array<unknown>) => void;

  constructor(options: {
    filterBy?: Selection | undefined;
    coordinator?: Coordinator | undefined | null;
    table: string;
    column: string;
    onResult: (values: Array<unknown>) => void;
  }) {
    super(options.filterBy);

    if (options.coordinator) {
      this.coordinator = options.coordinator;
    } else {
      this.coordinator = defaultCoordinator();
    }

    this.from = options.table;
    this.column = options.column;
    this.onResult = options.onResult;
  }

  override query(primaryFilter?: FilterExpr | null | undefined): SelectQuery {
    const statement = mSql.Query.from(this.from).select(this.column);

    if (primaryFilter) {
      statement.where(primaryFilter);
    }

    statement.groupby(this.column);

    return statement;
  }

  override queryResult(table: unknown): this {
    if (isArrowTable(table)) {
      const rows = table.toArray();
      const values: Array<unknown> = [];

      rows.forEach((row) => {
        const value = row[this.column];
        values.push(value);
      });

      this.onResult(values);
    }

    return this;
  }
}