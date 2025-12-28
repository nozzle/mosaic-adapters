/**
 * Factory for constructing Mosaic SQL Select queries from table state.
 * Translates TanStack Table state (filtering, sorting, pagination) into executable SQL.
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
  excludeColumnId?: string; // For cascading facets
  /**
   * The predicate to use for highlighting rows.
   * If provided, a computed column `__is_highlighted` (1 or 0) will be added.
   */
  highlightPredicate?: mSql.FilterExpr | null;
  /**
   * If true, skip adding the `__is_highlighted` column to the SELECT list.
   * Use this when the source (subquery) already calculates it.
   */
  manualHighlight?: boolean;
}

export function buildTableQuery<TData extends RowData, TValue>(
  options: QueryBuilderOptions<TData, TValue>,
): SelectQuery {
  const {
    source,
    tableState,
    mapper,
    totalRowsColumnName,
    totalRowsMode,
    excludeColumnId,
    highlightPredicate,
    manualHighlight,
  } = options;

  const { pagination, sorting, columnFilters } = tableState;

  const selectColumns = mapper.getSelectColumns().map((col) => {
    if (col.includes('.')) {
      const structExpr = createStructAccess(col);
      return { [col]: structExpr };
    }
    return mSql.column(col);
  });

  const extraSelects: Record<string, any> = {};

  if (totalRowsMode === 'window') {
    extraSelects[totalRowsColumnName] = mSql.sql`COUNT(*) OVER()`;
  }

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

  const whereClauses: Array<mSql.FilterExpr> = [];

  columnFilters.forEach((filter) => {
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

  const orderingCriteria: Array<mSql.OrderByNode> = [];
  sorting.forEach((sort) => {
    const sqlColumn = mapper.getSqlColumn(sort.id);
    if (sqlColumn) {
      const colExpr = createStructAccess(sqlColumn);
      orderingCriteria.push(sort.desc ? mSql.desc(colExpr) : mSql.asc(colExpr));
    }
  });

  statement.orderby(...orderingCriteria);

  statement
    .limit(pagination.pageSize)
    .offset(pagination.pageIndex * pagination.pageSize);

  // DEBUG LOG: This allows us to see exactly what is being sent to DuckDB.
  logger.debug(
    'SQL',
    `Final SQL for source "${source}":\n${statement.toString()}`,
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
