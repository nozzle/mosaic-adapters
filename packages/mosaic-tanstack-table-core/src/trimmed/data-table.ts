// packages/mosaic-tanstack-table-core/src/trimmed/data-table.ts
import {
  MosaicClient,
  Selection,
  coordinator as defaultCoordinator,
  isArrowTable,
  isParam,
  queryFieldInfo,
} from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { getCoreRowModel, getFacetedRowModel } from '@tanstack/table-core';
import { Store, batch } from '@tanstack/store';
import {
  escapeSqlLikePattern,
  functionalUpdate,
  seedInitialTableState,
  toRangeValue,
  toSafeSqlColumnName,
} from './utils';
import { logger } from './logger';

import type {
  Coordinator,
  FieldInfo,
  FieldInfoRequest,
  Param,
  SelectionClause,
} from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  ColumnDef,
  ColumnFilter,
  RowData,
  Table,
  TableOptions,
} from '@tanstack/table-core';
import type {
  MosaicDataTableOptions,
  MosaicDataTableSqlFilterType,
  MosaicDataTableStore,
} from './types';

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

const DEFAULT_SQL_FILTER_TYPE: MosaicDataTableSqlFilterType = 'EQUALS';

interface ActiveFacetClient extends MosaicClient {
  disconnect: () => void;
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
  tableFilterSelection!: Selection;

  facets: Map<string, any> = new Map();

  #store!: Store<MosaicDataTableStore<TData, TValue>>;
  #sql_total_rows = toSafeSqlColumnName('__total_rows');
  #onTableStateChange: 'requestQuery' | 'requestUpdate' = 'requestUpdate';

  #columnDefIdToSqlColumnAccessor: Map<string, string> = new Map();
  #columnDefIdToFieldInfo: Map<string, FieldInfo> = new Map();
  #sqlColumnAccessorToFieldInfo: Map<string, FieldInfo> = new Map();
  #sqlColumnAccessorToColumnDef: Map<string, ColumnDef<TData, TValue>> =
    new Map();

  // Registry to track active facet sidecar clients.
  // We generalize this to ActiveFacetClient to support both List (Unique Values) and Range (Min/Max) clients
  // while ensuring we can call disconnect() on them.
  #activeFacetClients: Map<string, ActiveFacetClient> = new Map();

  constructor(options: MosaicDataTableOptions<TData, TValue>) {
    super(options.filterBy); // pass the appropriate Filter Selection

    this.from = options.table;

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

    if (options.tableFilterSelection) {
      this.tableFilterSelection = options.tableFilterSelection;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (!this.tableFilterSelection) {
      this.tableFilterSelection = new Selection();
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
        _facetsUpdateCount: 0,
      });
    } else {
      this.#store.setState((prev) => ({
        ...prev,
        columnDefs:
          options.columns !== undefined ? options.columns : prev.columnDefs,
      }));
    }

    // CRITICAL FIX:
    // If columns are provided, we must immediately rebuild the internal maps
    // that link ColumnIDs to SQL columns and Metadata.
    // Without this, `getSqlFilters` (called during query generation) will fail
    // to find the correct SQL column or filter type, defaulting to EQUALS
    // which breaks Range filtering.
    if (options.columns) {
      this.getColumnsDefs();
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

    // Add column filters (internal filters)
    // We get all filters without exclusion for the main table query
    const internalClauses = this.getSqlFilters();

    if (internalClauses.length > 0) {
      whereClauses.push(...internalClauses);
    }

    // Update Internal Filter Selection
    // to allow bidirectional filtering (Table -> Charts)
    // We rely on mSql.and() to handle the variadic logic.
    // If the array is empty, it returns null/undefined.
    // If it has one item, it returns that item (identity).
    // If it has multiple, it wraps them in a LogicalAnd node.
    const predicate =
      internalClauses.length > 0 ? mSql.and(...internalClauses) : null;

    this.tableFilterSelection.update({
      source: this,
      value: tableState.columnFilters,
      predicate: predicate,
    });

    // Apply all where clauses to the Table Query
    statement.where(...whereClauses);

    // Add sorting
    const orderingCriteria: Array<mSql.OrderByNode> = [];
    sorting.forEach((sort) => {
      const columnAccessor = this.#columnDefIdToSqlColumnAccessor.get(sort.id)!; // Assertion is safe due to filtering above

      // Build the sorting command based on direction
      orderingCriteria.push(
        sort.desc
          ? mSql.desc(mSql.column(columnAccessor))
          : mSql.asc(mSql.column(columnAccessor)),
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

  /**
   * Generates SQL Filter Expressions from the current table state,
   * optionally excluding a specific column ID (for cascading facets).
   */
  private getSqlFilters(excludeColumnId?: string): Array<mSql.FilterExpr> {
    const tableState = this.#store.state.tableState;
    const columnFilters = tableState.columnFilters;
    const filters: Array<mSql.FilterExpr> = [];

    columnFilters.forEach((filter) => {
      // THE CASCADING LOGIC: Skip if it matches the excluded ID
      if (excludeColumnId && filter.id === excludeColumnId) {
        return;
      }

      const clause = this.generateClause(filter);
      if (clause) filters.push(clause);
    });

    return filters;
  }

  /**
   * Helper to generate a single SQL clause from a ColumnFilter
   */
  private generateClause(
    columnFilter: ColumnFilter,
  ): mSql.FilterExpr | undefined {
    // Only consider filters for Columns that can be mapped to Mosaic columns
    if (!this.#columnDefIdToSqlColumnAccessor.has(columnFilter.id)) {
      return undefined;
    }

    const columnAccessor = this.#columnDefIdToSqlColumnAccessor.get(
      columnFilter.id,
    )!;

    // Find the Column Definition to check for metadata
    const colDefMeta =
      this.#sqlColumnAccessorToColumnDef.get(columnAccessor)?.meta
        ?.mosaicDataTable;

    const filterType = colDefMeta?.sqlFilterType ?? DEFAULT_SQL_FILTER_TYPE;

    let clause: mSql.FilterExpr | undefined;

    switch (filterType) {
      case 'RANGE': {
        // Only handle Range Filters (Array values for Min/Max)
        if (!Array.isArray(columnFilter.value)) {
          logger.warn(
            'Core',
            `[MosaicDataTable] Column "${columnFilter.id}" has a non-array value but filterType is "range". Skipping to avoid invalid SQL.`,
          );
          break;
        }

        const [rawMin, rawMax] = columnFilter.value as [unknown, unknown];

        const min = toRangeValue(rawMin);
        const max = toRangeValue(rawMax);

        // Explicit check: If both are null, we cannot generate a valid range clause
        if (min === null && max === null) {
          break;
        }

        // Build SQL clauses using Mosaic literals to handle type safety
        if (min !== null && max !== null) {
          clause = mSql.isBetween(mSql.column(columnAccessor), [
            mSql.literal(min),
            mSql.literal(max),
          ]);
        } else if (min !== null) {
          clause = mSql.gte(mSql.column(columnAccessor), mSql.literal(min));
        } else if (max !== null) {
          clause = mSql.lte(mSql.column(columnAccessor), mSql.literal(max));
        }

        // Logging to debug "Literal" input issues
        if (!clause) {
          logger.debug('Core', 'Empty RANGE clause generated', {
            id: columnFilter.id,
            rawMin,
            rawMax,
            parsedMin: min,
            parsedMax: max,
          });
        }

        break;
      }
      case 'ILIKE':
      case 'LIKE':
      case 'PARTIAL_LIKE':
      case 'PARTIAL_ILIKE': {
        const rawValue = columnFilter.value;

        // 1. Strict Input Validation
        if (typeof rawValue !== 'string' || rawValue.length === 0) {
          logger.warn(
            'Core',
            `[MosaicDataTable] Column "${columnFilter.id}" has invalid value for text filter. Expected non-empty string.`,
            { value: rawValue, filterType },
          );
          break;
        }

        // 2. Determine Operator (Case Sensitivity)
        // Explicitly map types to operators to avoid boolean logic confusion
        const isCaseSensitive =
          filterType === 'LIKE' || filterType === 'PARTIAL_LIKE';
        const operator = isCaseSensitive ? 'LIKE' : 'ILIKE';

        // 3. Determine Pattern (Partial vs Exact)
        const isPartial =
          filterType === 'PARTIAL_LIKE' || filterType === 'PARTIAL_ILIKE';

        let pattern: string;

        if (isPartial) {
          // Hardening: Escape wildcards so "100%" means literal 100%, not "100[anything]"
          pattern = `%${escapeSqlLikePattern(rawValue)}%`;
        } else {
          // For exact/wildcard modes, we trust the input is either exact
          // or the developer intentionally wants to allow wildcards (standard SQL behavior)
          pattern = rawValue;
        }

        // 4. Construct Query
        // mSql.literal handles SQL Injection safety (quote escaping)
        clause = mSql.sql`${mSql.column(columnAccessor)} ${operator} ${mSql.literal(pattern)}`;
        break;
      }
      case 'EQUALS': {
        // Fix: Allow 0, false, but reject null, undefined, empty string
        if (
          columnFilter.value === null ||
          columnFilter.value === undefined ||
          columnFilter.value === ''
        ) {
          logger.warn(
            'Core',
            `[MosaicDataTable] Column "${columnFilter.id}" has empty value for EQUALS filter.`,
          );
          break;
        }
        clause = mSql.eq(
          mSql.column(columnAccessor),
          mSql.literal(columnFilter.value),
        );
        break;
      }
      default:
        break;
    }

    return clause;
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
    // Clean up sidecar clients
    this.#activeFacetClients.forEach((client) => client.disconnect());
    this.#activeFacetClients.clear();
  }

  // --- Faceting Support ---

  /**
   * Loads unique values for a specific column (for Select dropdowns).
   * Respects the external `filterBy` selection AND internal cascading filters.
   */
  loadColumnFacet(columnId: string) {
    const sqlColumn = this.#columnDefIdToSqlColumnAccessor.get(columnId);
    if (!sqlColumn) return;

    // Prevent duplicate clients
    if (this.#activeFacetClients.has(columnId)) return;

    // Use a helper client to fetch unique values
    const facetClient = new UniqueColumnValuesClient({
      table: this.sourceTable(),
      column: sqlColumn,
      filterBy: this.filterBy, // Listen to global filters
      coordinator: this.coordinator,
      // Provide a callback to get internal filters excluding self (cascading)
      getInternalFilter: () => this.getSqlFilters(columnId),
      onResult: (values) => {
        this.facets.set(columnId, values);
        // Trigger a state update so React re-renders the dropdowns
        batch(() => {
          this.#store.setState((prev) => ({
            ...prev,
            _facetsUpdateCount: prev._facetsUpdateCount + 1,
          }));
        });
      },
    });

    // Register and connect the sidecar client
    this.#activeFacetClients.set(columnId, facetClient);
    facetClient.connect();
    facetClient.requestUpdate();
  }

  /**
   * Loads Min/Max values for a column (for Range Sliders).
   *
   * This registers a "Sidecar Client" that listens to the Coordinator.
   * Unlike a one-off query, this ensures that if external charts filter the data,
   * the Min/Max bounds of our slider will update to reflect the new subset.
   */
  loadColumnMinMax(columnId: string) {
    const sqlColumn = this.#columnDefIdToSqlColumnAccessor.get(columnId);
    if (!sqlColumn) return;

    // Unique key to prevent duplicate listeners for the same column
    const clientKey = `${columnId}_minmax`;
    if (this.#activeFacetClients.has(clientKey)) return;

    const facetClient = new MinMaxColumnValuesClient({
      table: this.sourceTable(),
      column: sqlColumn,
      filterBy: this.filterBy, // Listen to global selection
      coordinator: this.coordinator,
      // Cascading: Include all table filters *except* this column's own filter
      getInternalFilter: () => this.getSqlFilters(columnId),
      onResult: (min, max) => {
        this.facets.set(columnId, [min, max]);

        // Trigger React re-render by touching the store
        batch(() => {
          this.#store.setState((prev) => ({
            ...prev,
            _facetsUpdateCount: prev._facetsUpdateCount + 1,
          }));
        });
      },
    });

    // Register for automatic cleanup via destroy()
    this.#activeFacetClients.set(clientKey, facetClient);

    // Activate
    facetClient.connect();
    facetClient.requestUpdate();
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

      // Store the mapping of SQL column accessor to ColumnDef
      this.#sqlColumnAccessorToColumnDef.set(columnAccessor, def);
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
          // Check if filters changed to update facet sidecars
          const oldFilters = JSON.stringify(
            JSON.parse(hashedOldState).columnFilters,
          );
          const newFilters = JSON.stringify(tableState.columnFilters);

          if (oldFilters !== newFilters) {
            // Wake up sidecars to re-calculate facets with new cascading filters
            this.#activeFacetClients.forEach((client) =>
              client.requestUpdate(),
            );
          }

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
      // Return a closure that reads the current value from the Map at the time of execution.
      // Previously, this captured the value at the time of *option creation*, leading to stale closures.
      return () => {
        const values = this.getFacets().get(columnId);

        if (!values) {
          return new Map<any, number>();
        }

        if (Array.isArray(values)) {
          const map = new Map<any, number>();
          values.forEach((value) => {
            map.set(value, 1);
          });
          return map;
        }

        return new Map<any, number>();
      };
    };
  }

  getFacetedMinMaxValues<TData extends RowData>(): (
    table: Table<TData>,
    columnId: string,
  ) => () => [any, any] | undefined {
    return (_table, columnId) => {
      // Return a closure that reads the current value from the Map at the time of execution.
      return () => {
        const values = this.getFacets().get(columnId);
        if (Array.isArray(values) && values.length === 2) {
          return values as [any, any];
        }
        return undefined;
      };
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
  getInternalFilter?: () => Array<mSql.FilterExpr>;
  onResult: (values: Array<unknown>) => void;

  constructor(options: {
    filterBy?: Selection | undefined;
    coordinator?: Coordinator | undefined | null;
    table: string;
    column: string;
    getInternalFilter?: () => Array<mSql.FilterExpr>;
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
    this.getInternalFilter = options.getInternalFilter;
    this.onResult = options.onResult;
  }

  connect(): void {
    this.coordinator?.connect(this);
  }

  disconnect(): void {
    this.coordinator?.disconnect(this);
  }

  override query(primaryFilter?: FilterExpr | null | undefined): SelectQuery {
    const statement = mSql.Query.from(this.from).select(this.column);

    const whereClauses: Array<mSql.FilterExpr> = [];

    // 1. Add Global Filters (Charts, etc)
    if (primaryFilter) {
      whereClauses.push(primaryFilter);
    }

    // 2. Add "Cascading" Internal Filters
    if (this.getInternalFilter) {
      const internalFilters = this.getInternalFilter();
      if (internalFilters.length > 0) {
        whereClauses.push(...internalFilters);
      }
    }

    if (whereClauses.length > 0) {
      statement.where(mSql.and(...whereClauses));
    }

    statement.groupby(this.column);
    statement.orderby(mSql.asc(mSql.column(this.column))); // Good UX to sort facets

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

/**
 * A sidecar Mosaic Client specifically for fetching Min/Max values.
 *
 * ARCHITECTURE NOTE:
 * We use a separate Client instance for this (instead of a one-off query)
 * so that it participates in the Mosaic lifecycle. When global filters change
 * (e.g. a user brushes a chart), the Coordinator will notify this client,
 * causing it to re-fetch the new Min/Max bounds automatically.
 */
export class MinMaxColumnValuesClient extends MosaicClient {
  private from: string;
  private column: string;
  private getInternalFilter?: () => Array<mSql.FilterExpr>;
  private onResult: (min: any, max: any) => void;

  constructor(options: {
    filterBy?: Selection;
    coordinator?: Coordinator | null;
    table: string;
    column: string;
    getInternalFilter?: () => Array<mSql.FilterExpr>;
    onResult: (min: any, max: any) => void;
  }) {
    super(options.filterBy);
    this.coordinator = options.coordinator ?? defaultCoordinator();
    this.from = options.table;
    this.column = options.column;
    this.getInternalFilter = options.getInternalFilter;
    this.onResult = options.onResult;
  }

  connect(): void {
    this.coordinator?.connect(this);
  }

  disconnect(): void {
    this.coordinator?.disconnect(this);
  }

  override query(primaryFilter?: FilterExpr | null): SelectQuery {
    const col = mSql.column(this.column);

    // Select Min and Max.
    // Note: We do not GROUP BY here, as we want the extent of the whole filtered dataset.
    const statement = mSql.Query.from(this.from).select({
      min: mSql.min(col),
      max: mSql.max(col),
    });

    const whereClauses: Array<mSql.FilterExpr> = [];

    // 1. Apply Global Mosaic Filters (e.g. Charts)
    if (primaryFilter) {
      whereClauses.push(primaryFilter);
    }

    // 2. Apply Table Internal Filters (Cascading)
    if (this.getInternalFilter) {
      const internal = this.getInternalFilter();
      if (internal.length > 0) {
        whereClauses.push(...internal);
      }
    }

    if (whereClauses.length > 0) {
      statement.where(mSql.and(...whereClauses));
    }

    logger.debug('Core', `[MinMax] Generated Query for ${this.column}`, {
      sql: statement.toString(),
    });

    return statement;
  }

  override queryResult(table: unknown): this {
    if (isArrowTable(table)) {
      const rows = table.toArray();
      if (rows.length > 0) {
        const row = rows[0] as any;
        // Callback to update the main Table store
        this.onResult(row.min, row.max);
      }
    }
    return this;
  }
}
