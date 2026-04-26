import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess } from '../utils';
import { buildRowIdentityPredicate } from './row-identity';
import type { ColumnMapper } from './column-mapper';
import type { RowIdentityConfig } from './row-identity';
import type { SelectQuery } from '@uwdata/mosaic-sql';
import type { RowData, TableState } from '@tanstack/table-core';

type SelectValue = ReturnType<typeof mSql.column> | ReturnType<typeof mSql.sql>;
type SelectColumn =
  | ReturnType<typeof mSql.column>
  | Record<string, SelectValue>;

export interface PinnedRowsQueryOptions<TData extends RowData, TValue> {
  source: string | SelectQuery;
  mapper: ColumnMapper<TData, TValue>;
  tableState: TableState;
  rowIdentity: RowIdentityConfig;
  rowIds: Array<string>;
}

export function buildPinnedRowsQuery<TData extends RowData, TValue>(
  options: PinnedRowsQueryOptions<TData, TValue>,
): SelectQuery | null {
  const predicate = buildRowIdentityPredicate(
    options.rowIdentity,
    options.rowIds,
  );
  if (!predicate) {
    return null;
  }

  const selectColumns: Array<SelectColumn> = options.mapper
    .getSelectColumns({
      tableState: options.tableState,
      rowIdentityFields: options.rowIdentity.fields,
    })
    .map(({ sql, alias }) => {
      const columnName = sql.toString();

      if (columnName.includes('.')) {
        return { [alias]: createStructAccess(sql) };
      }
      if (alias !== columnName) {
        return { [alias]: mSql.column(columnName) };
      }
      return mSql.column(columnName);
    });

  const statement = mSql.Query.from(options.source).select(...selectColumns);
  statement.where(predicate);
  return statement;
}
