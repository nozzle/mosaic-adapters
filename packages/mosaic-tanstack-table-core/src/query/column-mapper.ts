import { logger } from '../logger';
import type { ColumnDef, RowData } from '@tanstack/table-core';
import type { FieldInfoRequest } from '@uwdata/mosaic-core';

export class ColumnMapper<TData extends RowData, TValue = unknown> {
  private idToSqlMap = new Map<string, string>();
  private sqlToDefMap = new Map<string, ColumnDef<TData, TValue>>();
  private columnAccessorKeys: Array<string> = [];
  public shouldSearchAllColumns = false;

  constructor(columnDefs: Array<ColumnDef<TData, TValue>>) {
    this.parse(columnDefs);
  }

  /**
   * Introspects the ColumnDefs to build internal lookup maps.
   */
  private parse(defs: Array<ColumnDef<TData, TValue>>) {
    // Clear previous state (though currently we create new instances on update)
    this.idToSqlMap.clear();
    this.sqlToDefMap.clear();
    this.columnAccessorKeys = [];
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

    queryableColumns.forEach((def, index) => {
      let columnAccessor: string | undefined = undefined;

      // 1. Check metadata existence FIRST
      const sqlColumnMeta = def.meta?.mosaicDataTable?.sqlColumn;

      // 2. Handle AccessorKey
      if ('accessorKey' in def && def.accessorKey) {
        const accessor =
          typeof def.accessorKey === 'string'
            ? def.accessorKey
            : def.accessorKey.toString();

        // If meta is missing, fallback to key (Safe assumption)
        columnAccessor = sqlColumnMeta || accessor;

        // Validate metadata match if present
        if (sqlColumnMeta !== undefined && sqlColumnMeta !== accessor) {
          logger.debug(
            'Core',
            `[ColumnMapper] Column definition accessorKey "${accessor}" differs from mosaicDataTable.sqlColumn "${sqlColumnMeta}". Using metadata.`,
            { def },
          );
        }

        if (!columnAccessor) {
          this.columnAccessorKeys.push(accessor);
          columnAccessor = accessor;
        } else {
          this.columnAccessorKeys.push(columnAccessor);
        }
      }
      // 3. Handle AccessorFn
      else if ('accessorFn' in def && typeof def.accessorFn === 'function') {
        if (!sqlColumnMeta) {
          // CRITICAL CHANGE: Throw Error instead of warning
          throw new Error(
            `[Mosaic ColumnMapper] Column at index ${index} uses 'accessorFn' but is missing required metadata.\n` +
              `You MUST provide 'meta.mosaicDataTable.sqlColumn' so Mosaic knows what to query.\n` +
              `Header: ${typeof def.header === 'string' ? def.header : 'Unknown'}`,
          );
        }
        this.columnAccessorKeys.push(sqlColumnMeta);
        columnAccessor = sqlColumnMeta;
      }

      if (!columnAccessor) {
        const message = `[ColumnMapper] Column definition is missing an \`accessorKey\` or valid \`mosaicDataTable.sqlColumn\` metadata to map to a Mosaic Query column. Please provide one of these properties.`;
        logger.error('Core', message, { def });
        throw new Error(message);
      }

      // 4. Validate ID
      // TanStack Table often auto-generates IDs, but best to be safe
      const id = def.id || columnAccessor;
      if (!id) {
        const message = `[ColumnMapper] Column definition is missing an \`id\` property and could not be inferred. Please provide an explicit \`id\` or use \`accessorKey\`.`;
        logger.error('Core', message, { def });
        throw new Error(message);
      }

      // Store mappings
      this.idToSqlMap.set(id, columnAccessor);
      this.sqlToDefMap.set(columnAccessor, def);
    });

    if (this.columnAccessorKeys.length === 0 && defs.length > 0) {
      // Fallback only if absolutely no columns were mappable (rare edge case)
      this.shouldSearchAllColumns = true;
    }
  }

  /**
   * Returns the SQL column name for a given TanStack Column ID.
   */
  public getSqlColumn(columnId: string): string | undefined {
    return this.idToSqlMap.get(columnId);
  }

  /**
   * Returns the original ColumnDef for a given SQL column name.
   */
  public getColumnDef(sqlColumn: string): ColumnDef<TData, TValue> | undefined {
    return this.sqlToDefMap.get(sqlColumn);
  }

  /**
   * Generates the array of fields required for the initial Mosaic FieldInfo request.
   */
  public getMosaicFieldRequests(tableName: string): Array<FieldInfoRequest> {
    if (this.shouldSearchAllColumns) {
      return [{ table: tableName, column: '*' }];
    }

    return this.columnAccessorKeys.map((accessor) => ({
      table: tableName,
      column: accessor,
    }));
  }

  /**
   * Returns a list of all mapped SQL column names to be used in the SELECT clause.
   */
  public getSelectColumns(): Array<string> {
    return this.columnAccessorKeys;
  }
}
