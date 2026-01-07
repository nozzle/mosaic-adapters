import { logger } from '../logger';
import { SqlIdentifier } from '../domain/sql-identifier';
import type { ColumnDef, RowData } from '@tanstack/table-core';
import type { FieldInfoRequest } from '@uwdata/mosaic-core';
import type { MosaicColumnMapping } from '../types';

export interface SelectColumnInfo {
  id: string; // The Table State ID (used for filtering/sorting)
  sql: SqlIdentifier; // The Source SQL Column
  alias: string; // The Output Alias (used for matching Accessor/Schema)
}

export class ColumnMapper<TData extends RowData, TValue = unknown> {
  public readonly id: string;
  private idToSqlMap = new Map<string, SqlIdentifier>();
  private sqlToDefMap = new Map<string, ColumnDef<TData, TValue>>();

  // Store pairs of (Table ID -> SQL Column) for generating the SELECT clause
  private selectList: Array<SelectColumnInfo> = [];

  public shouldSearchAllColumns = false;

  constructor(
    columnDefs: Array<ColumnDef<TData, TValue>>,
    private mapping?: MosaicColumnMapping<TData>,
  ) {
    // Generate stateless ID for debug logs without relying on global module state
    this.id = Math.random().toString(36).substring(2, 9);
    this.parse(columnDefs);
  }

  /**
   * Introspects the ColumnDefs to build internal lookup maps.
   */
  private parse(defs: Array<ColumnDef<TData, TValue>>) {
    this.idToSqlMap.clear();
    this.sqlToDefMap.clear();
    this.selectList = [];
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

      // 1. Try to resolve via Strict Mapping first
      if (this.mapping && 'accessorKey' in def && def.accessorKey) {
        const key = def.accessorKey as string;
        const config = this.mapping[key];
        if (config) {
          columnAccessor = config.sqlColumn;
        }
      }

      // 2. Fallback: Check metadata (Deprecated but supported for migration)
      const sqlColumnMeta = def.meta?.mosaicDataTable?.sqlColumn;

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

        if (!columnAccessor) {
          throw new Error(
            `[Mosaic ColumnMapper #${this.id}] Column at index ${index} uses 'accessorFn' but is missing required mapping or metadata.\n` +
              `You MUST provide a 'mapping' or 'meta.mosaicDataTable.sqlColumn' so Mosaic knows what to query.\n` +
              `Header: ${typeof def.header === 'string' ? def.header : 'Unknown'}`,
          );
        }
      }

      if (!columnAccessor) {
        const message = `[ColumnMapper #${this.id}] Column definition is missing an \`accessorKey\` or valid mapping to map to a Mosaic Query column.`;
        logger.error('Core', message, { def });
        throw new Error(message);
      }

      // 5. Validate ID
      const id =
        def.id ||
        ('accessorKey' in def && typeof def.accessorKey === 'string'
          ? def.accessorKey
          : columnAccessor);
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
      const safeIdentifier = SqlIdentifier.from(columnAccessor);
      this.idToSqlMap.set(id, safeIdentifier);
      this.sqlToDefMap.set(columnAccessor, def);

      // Keep track of the selection list (ID -> SQL)
      this.selectList.push({ id, sql: safeIdentifier, alias });
    });

    if (this.selectList.length === 0 && defs.length > 0) {
      this.shouldSearchAllColumns = true;
    }
  }

  public getSqlColumn(columnId: string): SqlIdentifier | undefined {
    return this.idToSqlMap.get(columnId);
  }

  public getMappingConfig(columnId: string) {
    if (!this.mapping) {
      return undefined;
    }
    const key = columnId;
    return this.mapping[key];
  }

  public getColumnDef(sqlColumn: string): ColumnDef<TData, TValue> | undefined {
    return this.sqlToDefMap.get(sqlColumn);
  }

  public getMosaicFieldRequests(tableName: string): Array<FieldInfoRequest> {
    if (this.shouldSearchAllColumns) {
      return [{ table: tableName, column: '*' }];
    }

    return this.selectList.map(({ sql }) => ({
      table: tableName,
      column: sql.toString(),
    }));
  }

  /**
   * Returns a list of mappings for the SELECT clause.
   */
  public getSelectColumns(): Array<SelectColumnInfo> {
    return this.selectList;
  }
}
