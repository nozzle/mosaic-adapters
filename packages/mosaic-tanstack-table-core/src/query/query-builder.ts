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
  includeTotalCount?: boolean; // Optimization flag
}

export function buildTableQuery<TData extends RowData, TValue>(
  options: QueryBuilderOptions<TData, TValue>,
): SelectQuery {
  const {
    source,
    tableState,
    mapper,
    totalRowsColumnName,
    excludeColumnId,
    includeTotalCount = true,
  } = options;

  const { pagination, sorting, columnFilters } = tableState;

  // 1. Select Columns
  const selectColumns = mapper
    .getSelectColumns()
    .map((col) => mSql.column(col));

  // 2. Base Query Construction
  const selectMap: Record<string, any> = {};

  // Optimization: Only include the Window Function if requested
  if (includeTotalCount) {
    selectMap[totalRowsColumnName] = mSql.sql`COUNT(*) OVER()`;
  }

  // We append the selectColumns...
  const statement = mSql.Query.from(source).select(
    ...selectColumns,
    selectMap,
  );

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
    500,
    'info',
    'SQL',
    'Generated Table Query',
    {
      sql: statement.toString(),
      isSubQuery: typeof source !== 'string',
      includesCount: includeTotalCount,
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