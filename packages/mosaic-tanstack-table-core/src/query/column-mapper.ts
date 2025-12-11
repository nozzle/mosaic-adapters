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

    if (queryableColumns.length === 0) {
      this.shouldSearchAllColumns = true;
    }

    queryableColumns.forEach((def) => {
      let columnAccessor: string | undefined = undefined;

      // 1. Handle AccessorKey
      if ('accessorKey' in def && def.accessorKey) {
        const accessor =
          typeof def.accessorKey === 'string'
            ? def.accessorKey
            : def.accessorKey.toString();

        // Validate metadata match if present
        if (
          def.meta?.mosaicDataTable?.sqlColumn !== undefined &&
          def.meta.mosaicDataTable.sqlColumn !== accessor
        ) {
          logger.warn(
            'Core',
            `[ColumnMapper] Column definition accessorKey "${accessor}" does not match the provided mosaicDataTable.sqlColumn "${def.meta.mosaicDataTable.sqlColumn}". The accessorKey will be used for querying in SQL-land.`,
            { def },
          );
        }

        this.columnAccessorKeys.push(accessor);
        columnAccessor = accessor;
      }
      // 2. Handle AccessorFn
      else if ('accessorFn' in def && typeof def.accessorFn === 'function') {
        if (def.meta?.mosaicDataTable?.sqlColumn !== undefined) {
          const mosaicColumn = def.meta.mosaicDataTable.sqlColumn;
          this.columnAccessorKeys.push(mosaicColumn);
          columnAccessor = mosaicColumn;
        } else {
          this.shouldSearchAllColumns = true;
          logger.warn(
            'Core',
            `[ColumnMapper] Column definition using \`accessorFn\` is missing required \`mosaicDataTable.sqlColumn\` metadata.`,
            {
              def,
              hint: `Without this, the resulting query will need to return all columns to try and satisfy the accessor function.`,
            },
          );
          return;
        }
      }

      if (!columnAccessor) {
        const message = `[ColumnMapper] Column definition is missing an \`accessorKey\` or valid \`mosaicDataTable.sqlColumn\` metadata to map to a Mosaic Query column. Please provide one of these properties.`;
        logger.error('Core', message, { def });
        throw new Error(message);
      }

      // 3. Validate ID
      // Infer ID from accessorKey if not provided explicitly, matching TanStack Table behavior.
      let id = def.id;
      if (!id && 'accessorKey' in def && typeof def.accessorKey === 'string') {
        id = def.accessorKey;
      }

      if (!id) {
        const message = `[ColumnMapper] Column definition is missing an \`id\` property and could not be inferred. Please provide an explicit \`id\` or use \`accessorKey\`.`;
        logger.error('Core', message, { def });
        throw new Error(message);
      }

      // Store mappings
      this.idToSqlMap.set(id, columnAccessor);
      this.sqlToDefMap.set(columnAccessor, def);
    });

    if (this.shouldSearchAllColumns) {
      this.columnAccessorKeys = [];
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
