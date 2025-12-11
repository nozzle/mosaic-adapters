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
  // FIX: Handle struct columns (e.g. "related_phrase.phrase")
  // We iterate the mapped columns and construct the SELECT clause.
  // If a column has a dot, we treat it as a struct access `parent.child`
  // and ALIAS it to the original key so TanStack Table can find it flatly.
  const selectColumns = mapper.getSelectColumns().map((col) => {
    if (col.includes('.')) {
      // Split "a.b" -> column("a"), column("b")
      // Reduce to sql`${col("a")}.${col("b")}` -> "a".b (unquoted field)
      const parts = col.split('.');
      const structExpr = parts.reduce((acc, part, index) => {
        if (index === 0) return mSql.column(part); // The actual column "related_phrase" gets quoted
        // The struct fields .phrase should NOT be quoted by DuckDB binder as "phrase", but as field access
        // TS Workaround: Pass string array as any to simulate TemplateStringsArray for raw fragment generation
        return mSql.sql`${acc}.${mSql.sql([part] as any)}`;
      }, null as any);

      return { [col]: structExpr };
    }
    // Standard column
    return mSql.column(col);
  });

  // Initialize statement with Total Rows Window Function
  // mSql.Query.from() handles both strings (table names) and SelectQuery objects (subqueries)
  const statement = mSql.Query.from(source).select(...selectColumns, {
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
      let colExpr;
      if (sqlColumn.includes('.')) {
        // Handle struct columns for sorting
        const parts = sqlColumn.split('.');
        colExpr = parts.reduce((acc, part, index) => {
          if (index === 0) return mSql.column(part);
          // TS Workaround: Pass string array as any to simulate TemplateStringsArray for raw fragment generation
          return mSql.sql`${acc}.${mSql.sql([part] as any)}`;
        }, null as any);
      } else {
        colExpr = mSql.column(sqlColumn);
      }

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