import * as mSql from '@uwdata/mosaic-sql';
import { logger } from '../logger';
import { createFilterClause } from './filter-factory';
import type { SelectQuery } from '@uwdata/mosaic-sql';
import type { RowData, TableState } from '@tanstack/table-core';
import type { ColumnMapper } from './column-mapper';

export interface QueryBuilderOptions<TData extends RowData, TValue = unknown> {
  source: string | SelectQuery;
  tableState: TableState;
  mapper: ColumnMapper<TData, TValue>;
  totalRowsColumnName: string;
  excludeColumnId?: string; // For cascading facets
}

export function buildTableQuery<TData extends RowData, TValue>(
  options: QueryBuilderOptions<TData, TValue>,
): SelectQuery {
  const { source, tableState, mapper, totalRowsColumnName, excludeColumnId } =
    options;

  const { pagination, sorting, columnFilters } = tableState;

  // 1. Select Columns
  const selectColumns = mapper
    .getSelectColumns()
    .map((col) => mSql.column(col));

  // 2. Base Query Construction
  // We use the "Wrapper Query" pattern.
  // Whether the source is a raw table string or a complex subquery object,
  // we wrap it in a new SELECT statement.
  // This allows us to apply Pagination (LIMIT/OFFSET) and Sorting (ORDER BY)
  // to the *results* of complex aggregations uniformly.
  const statement = mSql.Query.from(source).select(...selectColumns, {
    // Window Function Trick:
    // We ask the DB to count the total rows in the *result set* (OVER())
    // and return it as a column on every row.
    // This avoids a separate network round-trip just to get the page count.
    [totalRowsColumnName]: mSql.sql`COUNT(*) OVER()`,
  });

  // 3. Generate WHERE Clauses (Internal Table Filters)
  const whereClauses: Array<mSql.FilterExpr> = [];

  columnFilters.forEach((filter) => {
    // Cascading logic: Skip if excluded (e.g. for a Facet Sidecar)
    if (excludeColumnId && filter.id === excludeColumnId) {
      return;
    }

    const sqlColumn = mapper.getSqlColumn(filter.id);
    if (!sqlColumn) {
      return;
    }

    const colDef = mapper.getColumnDef(sqlColumn);
    const filterType = colDef?.meta?.mosaicDataTable?.sqlFilterType;

    const clause = createFilterClause({
      sqlColumn,
      filterType,
      value: filter.value,
      columnId: filter.id,
    });

    if (clause) {
      whereClauses.push(clause);
    }
  });

  if (whereClauses.length > 0) {
    statement.where(...whereClauses);
  }

  // 4. Apply Sorting
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

  // 5. Apply Pagination
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
      isSubQuery: typeof source !== 'string',
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
export function extractInternalFilters<TData extends RowData, TValue>(options: {
  tableState: TableState;
  mapper: ColumnMapper<TData, TValue>;
}): Array<mSql.FilterExpr> {
  const clauses: Array<mSql.FilterExpr> = [];

  options.tableState.columnFilters.forEach((filter) => {
    const sqlColumn = options.mapper.getSqlColumn(filter.id);
    if (!sqlColumn) {
      return;
    }

    const colDef = options.mapper.getColumnDef(sqlColumn);
    const filterType = colDef?.meta?.mosaicDataTable?.sqlFilterType;

    const clause = createFilterClause({
      sqlColumn,
      filterType,
      value: filter.value,
      columnId: filter.id,
    });

    if (clause) {
      clauses.push(clause);
    }
  });

  return clauses;
}
