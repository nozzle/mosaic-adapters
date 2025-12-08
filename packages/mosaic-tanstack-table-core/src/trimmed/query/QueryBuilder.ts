// Orchestrates the construction of the final SQL SELECT query for the Table.
// Joins Pagination, Sorting, Columns, and Filters.

import * as mSql from '@uwdata/mosaic-sql';
import { logger } from '../logger';
import { createFilterClause } from './FilterFactory';
import type { SelectQuery } from '@uwdata/mosaic-sql';
import type { RowData, TableState } from '@tanstack/table-core';
import type { ColumnMapper } from './ColumnMapper';

export interface QueryBuilderOptions<TData extends RowData, TValue = unknown> {
  tableName: string;
  tableState: TableState;
  mapper: ColumnMapper<TData, TValue>;
  totalRowsColumnName: string;
  excludeColumnId?: string; // For cascading facets
}

export function buildTableQuery<TData extends RowData, TValue>(
  options: QueryBuilderOptions<TData, TValue>,
): SelectQuery {
  const {
    tableName,
    tableState,
    mapper,
    totalRowsColumnName,
    excludeColumnId,
  } = options;

  const { pagination, sorting, columnFilters } = tableState;

  // 1. Select Columns
  const selectColumns = mapper
    .getSelectColumns()
    .map((col) => mSql.column(col));

  // Initialize statement with Total Rows Window Function
  const statement = mSql.Query.from(tableName).select(...selectColumns, {
    [totalRowsColumnName]: mSql.sql`COUNT(*) OVER()`,
  });

  // 2. Generate WHERE Clauses (Internal Table Filters)
  const whereClauses: Array<mSql.FilterExpr> = [];

  columnFilters.forEach((filter) => {
    // Cascading logic: Skip if excluded (e.g. for a Facet Sidecar)
    if (excludeColumnId && filter.id === excludeColumnId) {
      return;
    }

    const sqlColumn = mapper.getSqlColumn(filter.id);
    if (!sqlColumn) return;

    const colDef = mapper.getColumnDef(sqlColumn);
    const filterType = colDef?.meta?.mosaicDataTable?.sqlFilterType;

    const clause = createFilterClause(
      sqlColumn,
      filterType,
      filter.value,
      filter.id,
    );

    if (clause) {
      whereClauses.push(clause);
    }
  });

  if (whereClauses.length > 0) {
    statement.where(...whereClauses);
  }

  // 3. Apply Sorting
  // Only sort by columns that exist in our mapping
  const orderingCriteria: Array<mSql.OrderByNode> = [];
  sorting.forEach((sort) => {
    const sqlColumn = mapper.getSqlColumn(sort.id);
    if (sqlColumn) {
      orderingCriteria.push(
        sort.desc
          ? mSql.desc(mSql.column(sqlColumn))
          : mSql.asc(mSql.column(sqlColumn)),
      );
    }
  });

  statement.orderby(...orderingCriteria);

  // 4. Apply Pagination
  statement
    .limit(pagination.pageSize)
    .offset(pagination.pageIndex * pagination.pageSize);

  logger.debounce(
    'sql-query-builder',
    300,
    'info',
    'SQL',
    'Generated Table Query',
    {
      sql: statement.toString(),
      context: {
        pagination,
        sorting,
        filtersCount: whereClauses.length,
      },
    },
  );

  return statement;
}

/**
 * Helper to extract just the internal filter expressions for cross-filtering.
 * This effectively runs the "WHERE" generation logic without constructing a full SELECT.
 */
export function extractInternalFilters<TData extends RowData, TValue>(
  tableState: TableState,
  mapper: ColumnMapper<TData, TValue>,
): Array<mSql.FilterExpr> {
  const clauses: Array<mSql.FilterExpr> = [];

  tableState.columnFilters.forEach((filter) => {
    const sqlColumn = mapper.getSqlColumn(filter.id);
    if (!sqlColumn) return;

    const colDef = mapper.getColumnDef(sqlColumn);
    const filterType = colDef?.meta?.mosaicDataTable?.sqlFilterType;

    const clause = createFilterClause(
      sqlColumn,
      filterType,
      filter.value,
      filter.id,
    );

    if (clause) {
      clauses.push(clause);
    }
  });

  return clauses;
}
