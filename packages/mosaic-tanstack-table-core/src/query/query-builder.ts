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
    excludeColumnId,
    highlightPredicate,
    manualHighlight,
  } = options;

  const { pagination, sorting, columnFilters } = tableState;

  // 1. Select Columns
  // We iterate the mapped columns and construct the SELECT clause.
  // If a column has a dot, we treat it as a struct access `parent.child`
  // and ALIAS it to the original key so TanStack Table can find it flatly.
  const selectColumns = mapper.getSelectColumns().map((col) => {
    if (col.includes('.')) {
      // Use helper to generate "a"."b" struct access
      const structExpr = createStructAccess(col);
      return { [col]: structExpr };
    }
    // Standard column
    return mSql.column(col);
  });

  const extraSelects: Record<string, any> = {
    [totalRowsColumnName]: mSql.sql`COUNT(*) OVER()`,
  };

  // Calculate Highlight Column if not in manual mode
  if (!manualHighlight) {
    let highlightCol;
    const isHighlightActive =
      highlightPredicate &&
      (!Array.isArray(highlightPredicate) || highlightPredicate.length > 0);

    if (isHighlightActive) {
      // Ensure the predicate is a valid SQL Node for interpolation.
      // If highlightPredicate is an array (implicit AND), wrap it.
      const safePredicate = Array.isArray(highlightPredicate)
        ? mSql.and(...highlightPredicate)
        : highlightPredicate;

      // SQL: MAX(CASE WHEN predicate THEN 1 ELSE 0 END)
      // We use MAX() to ensure safety with GROUP BY queries (if the source is aggregated).
      // If *any* record in the group matches the filter, the group is highlighted.
      const caseExpr = mSql.sql`CASE WHEN ${safePredicate} THEN 1 ELSE 0 END`;
      highlightCol = mSql.max(caseExpr);
    } else {
      // If no filter exists (or it's empty), everything is highlighted (default state)
      highlightCol = mSql.literal(1);
    }
    extraSelects['__is_highlighted'] = highlightCol;
  }

  // Initialize statement with Total Rows Window Function and Highlight Flag
  // mSql.Query.from() handles both strings (table names) and SelectQuery objects (subqueries)
  const statement = mSql.Query.from(source).select(
    ...selectColumns,
    extraSelects,
  );

  // 2. Generate WHERE Clauses (Internal Table Filters)
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

  // 3. Apply Sorting
  // Only sort by columns that exist in our mapping
  const orderingCriteria: Array<mSql.OrderByNode> = [];
  sorting.forEach((sort) => {
    const sqlColumn = mapper.getSqlColumn(sort.id);
    if (sqlColumn) {
      // Use createStructAccess for sorting nested columns too
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
    'info',
    'SQL',
    'Generated Table Query',
    {
      sql: statement.toString(),
      context: {
        pagination,
        sorting,
        filtersCount: whereClauses.length,
        hasHighlight: !manualHighlight, // Updated log to reflect status
        highlightPredicateRaw: highlightPredicate,
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
