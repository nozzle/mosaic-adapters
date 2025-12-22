/**
 * Query Builder logic for constructing the primary SQL SelectQuery for the table.
 * Handles column mapping, sorting, pagination, and total row count injection.
 */

import * as mSql from '@uwdata/mosaic-sql';
import { logger } from '../logger';
import { createStructAccess } from '../utils';

import { createFilterClause } from './filter-factory';
import type { SelectQuery } from '@uwdata/mosaic-sql';
import type { RowData, TableState } from '@tanstack/table-core';
import type { ColumnMapper } from './column-mapper';

export interface QueryBuilderOptions<TData extends RowData, TValue = unknown> {
  source: string | SelectQuery;
  tableState: TableState;
  mapper: ColumnMapper<TData, TValue>;
  totalRowsColumnName: string;
  totalRowsMode?: 'split' | 'window';
  excludeColumnId?: string;
  highlightPredicate?: mSql.FilterExpr | null;
  manualHighlight?: boolean;
}

export function buildTableQuery<TData extends RowData, TValue>(
  options: QueryBuilderOptions<TData, TValue>,
): SelectQuery {
  const {
    source,
    tableState,
    mapper,
    highlightPredicate,
    manualHighlight,
    totalRowsMode,
    totalRowsColumnName,
  } = options;

  const { pagination, sorting } = tableState;

  // 1. Select Columns
  const selectColumns = mapper.getSelectColumns().map((col: string) => {
    if (col.includes('.')) {
      const structExpr = createStructAccess(col);
      return { [col]: structExpr };
    }
    return mSql.column(col);
  });

  const extraSelects: Record<string, any> = {};

  // WINDOW MODE: Add the total count as a window function to every row
  if (totalRowsMode === 'window') {
    extraSelects[totalRowsColumnName] = mSql.sql`COUNT(*) OVER()`;
  }

  // Calculate Highlight Column
  if (!manualHighlight) {
    let highlightCol;
    const isHighlightActive =
      highlightPredicate &&
      (!Array.isArray(highlightPredicate) || highlightPredicate.length > 0);

    if (isHighlightActive) {
      const safePredicate = Array.isArray(highlightPredicate)
        ? mSql.and(...highlightPredicate)
        : highlightPredicate;

      const caseExpr = mSql.sql`CASE WHEN ${safePredicate} THEN 1 ELSE 0 END`;
      highlightCol = mSql.max(caseExpr);
    } else {
      highlightCol = mSql.literal(1);
    }
    extraSelects['__is_highlighted'] = highlightCol;
  }

  const statement = mSql.Query.from(source).select(
    ...selectColumns,
    extraSelects,
  );

  // 2. Generate WHERE Clauses
  const whereClauses = extractInternalFilters(options);
  if (whereClauses.length > 0) {
    statement.where(...whereClauses);
  }

  // 3. Apply Sorting
  const orderingCriteria: Array<mSql.OrderByNode> = [];
  sorting.forEach((sort) => {
    const sqlColumn = mapper.getSqlColumn(sort.id);
    if (sqlColumn) {
      const colExpr = createStructAccess(sqlColumn);
      orderingCriteria.push(sort.desc ? mSql.desc(colExpr) : mSql.asc(colExpr));
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
    'debug',
    'SQL',
    'Generated Table Query',
    {
      sql: statement.toString(),
      context: {
        pagination,
        sorting,
        filtersCount: whereClauses.length,
        hasHighlight: !manualHighlight,
        totalRowsMode,
      },
    },
  );

  return statement;
}

/**
 * Helper to extract just the internal filter expressions.
 */
export function extractInternalFilters<TData extends RowData, TValue>(options: {
  tableState: TableState;
  mapper: ColumnMapper<TData, TValue>;
  excludeColumnId?: string;
}): Array<mSql.FilterExpr> {
  const clauses: Array<mSql.FilterExpr> = [];

  options.tableState.columnFilters.forEach((filter) => {
    if (options.excludeColumnId && filter.id === options.excludeColumnId) {
      return;
    }

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
