import { logger } from '../logger';
import { SqlIdentifier } from '../domain/sql-identifier';
import { readMosaicColumnMeta } from './column-meta';
import { planProjection } from './projection-planner';
import type { RowData, TableState } from '@tanstack/table-core';
import type { FieldInfoRequest } from '@uwdata/mosaic-core';
import type { MosaicColumnDef, MosaicColumnMapping } from '../types';

export interface SelectColumnInfo {
  id: string; // The Table State ID (used for filtering/sorting)
  sql: SqlIdentifier; // The Source SQL Column
  alias: string; // The Output Alias (used for matching Accessor/Schema)
}

type ColumnMapperEntry = {
  id: string;
  visibleSelects: Array<SelectColumnInfo>;
  declaredSelects: Array<SelectColumnInfo>;
  sortSql?: SqlIdentifier;
  filterSql?: SqlIdentifier;
  facetSql?: SqlIdentifier;
  globalFilterSqls: Array<SqlIdentifier>;
};

export interface SelectProjectionOptions {
  tableState: TableState;
  rowIdentityField?: string;
}

export class ColumnMapper<TData extends RowData, TValue = unknown> {
  public readonly id: string;
  private idToSqlMap = new Map<string, SqlIdentifier>();
  private idToSortSqlMap = new Map<string, SqlIdentifier>();
  private idToFilterSqlMap = new Map<string, SqlIdentifier>();
  private idToFacetSqlMap = new Map<string, SqlIdentifier>();
  private idToDefMap = new Map<string, MosaicColumnDef<TData, TValue>>();
  private sqlToDefMap = new Map<string, MosaicColumnDef<TData, TValue>>();

  // Store pairs of (Table ID -> SQL Column) for generating the SELECT clause
  private selectList: Array<SelectColumnInfo> = [];
  private entries: Array<ColumnMapperEntry> = [];

  public shouldSearchAllColumns = false;

  constructor(
    columnDefs: Array<MosaicColumnDef<TData, TValue>>,
    private mapping?: MosaicColumnMapping<TData>,
  ) {
    // Generate stateless ID for debug logs without relying on global module state
    this.id = Math.random().toString(36).substring(2, 9);
    this.parse(columnDefs);
  }

  /**
   * Introspects the ColumnDefs to build internal lookup maps.
   */
  private parse(defs: Array<MosaicColumnDef<TData, TValue>>) {
    this.idToSqlMap.clear();
    this.idToSortSqlMap.clear();
    this.idToFilterSqlMap.clear();
    this.idToFacetSqlMap.clear();
    this.idToDefMap.clear();
    this.sqlToDefMap.clear();
    this.selectList = [];
    this.entries = [];
    this.shouldSearchAllColumns = false;

    // Filter to queryable columns
    const queryableColumns = defs.filter((def) => {
      if (
        'accessorKey' in def &&
        typeof def.accessorKey === 'string' &&
        def.accessorKey.length > 0
      ) {
        return true;
      }
      if ('accessorFn' in def && typeof def.accessorFn === 'function') {
        return true;
      }
      return false;
    });

    if (queryableColumns.length > 0) {
      logger.debug(
        'Core',
        `[ColumnMapper #${this.id}] Parsing ${queryableColumns.length} columns`,
      );
    }

    queryableColumns.forEach((def, index) => {
      let columnAccessor: string | undefined = undefined;
      const meta = readMosaicColumnMeta(def);

      // 1. Try to resolve via Strict Mapping first
      if (this.mapping && 'accessorKey' in def && def.accessorKey) {
        const key = def.accessorKey as string;
        const config = this.mapping[key];
        if (config) {
          columnAccessor = config.sqlColumn;
        }
      }

      // 2. Fallback: Check metadata (Deprecated but supported for migration)
      const sqlColumnMeta = meta.sqlColumn;

      // 3. Handle AccessorKey Fallbacks
      if ('accessorKey' in def && def.accessorKey) {
        const accessor =
          typeof def.accessorKey === 'string'
            ? def.accessorKey
            : def.accessorKey.toString();

        if (!columnAccessor) {
          columnAccessor = sqlColumnMeta || accessor;
        }

        if (
          sqlColumnMeta !== undefined &&
          sqlColumnMeta !== accessor &&
          !this.mapping
        ) {
          logger.debug(
            'Core',
            `[ColumnMapper #${this.id}] Column definition accessorKey "${accessor}" differs from mosaicDataTable.sqlColumn "${sqlColumnMeta}". Using metadata.`,
            { def },
          );
        }
      }
      // 4. Handle AccessorFn Fallbacks
      else if ('accessorFn' in def && typeof def.accessorFn === 'function') {
        if (!columnAccessor && sqlColumnMeta) {
          columnAccessor = sqlColumnMeta;
        }

        if (!columnAccessor && (!meta.fields || meta.fields.length === 0)) {
          throw new Error(
            `[Mosaic ColumnMapper #${this.id}] Column at index ${index} uses 'accessorFn' but is missing required mapping or metadata.\n` +
              `You MUST provide a 'mapping', 'meta.mosaic.sqlColumn', 'meta.mosaic.fields', or 'meta.mosaicDataTable.sqlColumn' so Mosaic knows what to query.\n` +
              `Header: ${typeof def.header === 'string' ? def.header : 'Unknown'}`,
          );
        }
      }

      if (!columnAccessor && (!meta.fields || meta.fields.length === 0)) {
        const message = `[ColumnMapper #${this.id}] Column definition is missing an \`accessorKey\` or valid mapping to map to a Mosaic Query column.`;
        logger.error('Core', message, { def });
        throw new Error(message);
      }

      // 5. Validate ID
      const id =
        def.id ||
        ('accessorKey' in def && typeof def.accessorKey === 'string'
          ? def.accessorKey
          : columnAccessor || meta.fields?.[0]);
      if (!id) {
        const message = `[ColumnMapper #${this.id}] Column definition is missing an \`id\` property and could not be inferred. Please provide an explicit \`id\` or use \`accessorKey\`.`;
        logger.error('Core', message, { def });
        throw new Error(message);
      }

      // 6. Determine Select Alias
      let alias = id;
      if (
        'accessorKey' in def &&
        typeof def.accessorKey === 'string' &&
        def.accessorKey.trim().length > 0 &&
        !def.accessorKey.includes('.')
      ) {
        alias = def.accessorKey;
      }

      // Store mappings using Safe Identifiers
      const visibleSelects: Array<SelectColumnInfo> = [];
      const declaredSelects = (meta.fields ?? []).map((field) =>
        this.createSelectInfo(id, field, field),
      );
      const sortSql = SqlIdentifier.from(meta.sortBy ?? columnAccessor ?? id);
      const filterSql = SqlIdentifier.from(
        meta.filterBy ?? columnAccessor ?? id,
      );
      const facetSql = SqlIdentifier.from(meta.facetBy ?? columnAccessor ?? id);
      const globalFilterSqls = (meta.globalFilterBy ?? []).map((field) =>
        SqlIdentifier.from(field),
      );

      if (columnAccessor) {
        const safeIdentifier = SqlIdentifier.from(columnAccessor);
        this.idToSqlMap.set(id, safeIdentifier);
        this.sqlToDefMap.set(columnAccessor, def);
        visibleSelects.push({ id, sql: safeIdentifier, alias });

        // Keep track of the selection list (ID -> SQL)
        this.selectList.push({ id, sql: safeIdentifier, alias });
      }

      this.idToDefMap.set(id, def);
      this.idToSortSqlMap.set(id, sortSql);
      this.idToFilterSqlMap.set(id, filterSql);
      this.idToFacetSqlMap.set(id, facetSql);
      this.sqlToDefMap.set(sortSql.toString(), def);
      this.sqlToDefMap.set(filterSql.toString(), def);
      this.sqlToDefMap.set(facetSql.toString(), def);
      globalFilterSqls.forEach((sql) => {
        this.sqlToDefMap.set(sql.toString(), def);
      });
      declaredSelects.forEach(({ sql }) => {
        this.sqlToDefMap.set(sql.toString(), def);
      });

      this.entries.push({
        id,
        visibleSelects,
        declaredSelects,
        sortSql,
        filterSql,
        facetSql,
        globalFilterSqls,
      });
    });

    // TRACE: Log the map to debug ID mismatch issues
    // Changed from console.log to logger.debug to respect log levels (hidden by default)
    logger.debug('Core', `[ColumnMapper #${this.id}] ID Mapping Table:`, {
      map: Array.from(this.idToSqlMap.entries()).map(
        ([id, sql]) => `${id} -> ${sql.toString()}`,
      ),
    });

    if (this.entries.length === 0 && defs.length > 0) {
      this.shouldSearchAllColumns = true;
    }
  }

  public getSqlColumn(columnId: string): SqlIdentifier | undefined {
    return this.idToSqlMap.get(columnId);
  }

  public getSortSqlColumn(columnId: string): SqlIdentifier | undefined {
    return this.idToSortSqlMap.get(columnId) ?? this.getSqlColumn(columnId);
  }

  public getFilterSqlColumn(columnId: string): SqlIdentifier | undefined {
    return this.idToFilterSqlMap.get(columnId) ?? this.getSqlColumn(columnId);
  }

  public getFacetSqlColumn(columnId: string): SqlIdentifier | undefined {
    return this.idToFacetSqlMap.get(columnId) ?? this.getSqlColumn(columnId);
  }

  public getGlobalFilterSqlColumns(): Array<SqlIdentifier> {
    const columns = new Map<string, SqlIdentifier>();
    this.entries.forEach((entry) => {
      entry.globalFilterSqls.forEach((sql) => {
        columns.set(sql.toString(), sql);
      });
    });
    return Array.from(columns.values());
  }

  public getMappingConfig(columnId: string) {
    if (!this.mapping) {
      return undefined;
    }
    const key = columnId;
    return this.mapping[key];
  }

  public getColumnDef(
    sqlColumn: string,
  ): MosaicColumnDef<TData, TValue> | undefined {
    return this.sqlToDefMap.get(sqlColumn);
  }

  public getColumnDefById(
    columnId: string,
  ): MosaicColumnDef<TData, TValue> | undefined {
    return this.idToDefMap.get(columnId);
  }

  public getMosaicFieldRequests(
    tableName: string,
    options?: SelectProjectionOptions,
  ): Array<FieldInfoRequest> {
    if (this.shouldSearchAllColumns) {
      return [{ table: tableName, column: '*' }];
    }

    const fields = options
      ? this.getSelectColumns(options)
      : this.getAllFieldSelects();

    return fields.map(({ sql }) => ({
      table: tableName,
      column: sql.toString(),
    }));
  }

  /**
   * Returns a list of mappings for the SELECT clause.
   */
  public getSelectColumns(
    options?: SelectProjectionOptions,
  ): Array<SelectColumnInfo> {
    if (!options) {
      return this.selectList;
    }

    const rowIdentityFields = options.rowIdentityField
      ? [options.rowIdentityField]
      : undefined;
    const fieldNames = planProjection({
      tableState: options.tableState,
      rowIdentityFields,
      columns: this.entries.map((entry) => ({
        id: entry.id,
        visibleSelects: entry.visibleSelects.map(({ sql }) => sql.toString()),
        declaredSelects: entry.declaredSelects.map(({ sql }) => sql.toString()),
        sortingSelects: entry.sortSql ? [entry.sortSql.toString()] : [],
        filteringSelects: entry.filterSql ? [entry.filterSql.toString()] : [],
        globalFilteringSelects: entry.globalFilterSqls.map((sql) =>
          sql.toString(),
        ),
      })),
    });

    return this.createProjectedSelects(fieldNames);
  }

  private createProjectedSelects(
    fields: Array<string>,
  ): Array<SelectColumnInfo> {
    const byField = new Map<string, SelectColumnInfo>();

    this.entries.forEach((entry) => {
      [...entry.visibleSelects, ...entry.declaredSelects].forEach((select) => {
        byField.set(select.sql.toString(), select);
      });
    });

    return fields.map((field) => {
      const configured = byField.get(field);
      if (configured) {
        return configured;
      }
      return this.createSelectInfo(field, field, field);
    });
  }

  private getAllFieldSelects(): Array<SelectColumnInfo> {
    const fields = new Map<string, SelectColumnInfo>();

    this.entries.forEach((entry) => {
      const selects = [
        ...entry.visibleSelects,
        ...entry.declaredSelects,
        ...(entry.sortSql
          ? [
              this.createSelectInfo(
                entry.id,
                entry.sortSql.toString(),
                entry.id,
              ),
            ]
          : []),
        ...(entry.filterSql
          ? [
              this.createSelectInfo(
                entry.id,
                entry.filterSql.toString(),
                entry.id,
              ),
            ]
          : []),
        ...(entry.facetSql
          ? [
              this.createSelectInfo(
                entry.id,
                entry.facetSql.toString(),
                entry.id,
              ),
            ]
          : []),
        ...entry.globalFilterSqls.map((sql) =>
          this.createSelectInfo(entry.id, sql.toString(), sql.toString()),
        ),
      ];

      selects.forEach((select) => {
        fields.set(select.sql.toString(), select);
      });
    });

    return Array.from(fields.values());
  }

  private createSelectInfo(
    id: string,
    sqlColumn: string,
    alias: string,
  ): SelectColumnInfo {
    return {
      id,
      sql: SqlIdentifier.from(sqlColumn),
      alias,
    };
  }
}
