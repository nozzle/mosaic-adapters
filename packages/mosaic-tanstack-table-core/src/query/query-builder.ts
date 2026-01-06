// packages/mosaic-tanstack-table-core/src/query/query-builder.ts
import * as mSql from '@uwdata/mosaic-sql';
import { logger } from '../logger';
import { createStructAccess, toRangeValue } from '../utils';

import type { SelectQuery } from '@uwdata/mosaic-sql';
import type { RowData, TableState } from '@tanstack/table-core';
import type { ColumnMapper } from './column-mapper';
import type { StrategyRegistry } from '../registry';
import type { FilterStrategy } from './filter-factory';
import type { FilterValue, MosaicColumnMapping } from '../types';

export interface QueryBuilderOptions<TData extends RowData, TValue = unknown> {
  source: string | SelectQuery;
  tableState: TableState;
  mapper: ColumnMapper<TData, TValue>;
  mapping?: MosaicColumnMapping<TData>;
  totalRowsColumnName: string;
  totalRowsMode?: 'split' | 'window';
  excludeColumnId?: string; // For cascading facets
  highlightPredicate?: mSql.FilterExpr | null;
  manualHighlight?: boolean;
  filterRegistry: StrategyRegistry<FilterStrategy>;
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
    highlightPredicate,
    manualHighlight,
  } = options;

  const { pagination, sorting } = tableState;

  // 1. Select Columns
  // UPDATED: We now use 'alias' from the mapper instead of 'id'.
  // This allows the ID (used for state/filtering) to differ from the Accessor (used for data reading).
  const selectColumns = mapper.getSelectColumns().map(({ sql, alias }) => {
    const colStr = sql.toString();

    // Struct access: SELECT "a"."b" AS "alias"
    if (colStr.includes('.')) {
      const structExpr = createStructAccess(sql);
      return { [alias]: structExpr };
    }

    // Simple column aliasing: SELECT "sql_col" AS "alias"
    if (alias !== colStr) {
      return { [alias]: mSql.column(colStr) };
    }

    // Direct match: SELECT "id"
    return mSql.column(colStr);
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
      },
    },
  );

  return statement;
}

/**
 * Extracts internal filters and converts weak TanStack state to Strong Types.
 */
export function extractInternalFilters<TData extends RowData, TValue>(options: {
  tableState: TableState;
  mapper: ColumnMapper<TData, TValue>;
  mapping?: MosaicColumnMapping<TData>;
  filterRegistry: StrategyRegistry<FilterStrategy>;
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

    // Resolve Configuration
    let filterType = 'EQUALS';

    // 1. Try Strict Mapping
    const mappingConfig = options.mapping?.[filter.id as keyof TData];
    if (mappingConfig) {
      filterType = mappingConfig.filterType || 'EQUALS';
    } else {
      // 2. Fallback to Meta
      const colDef = options.mapper.getColumnDef(sqlColumn.toString());
      filterType = colDef?.meta?.mosaicDataTable?.sqlFilterType || 'EQUALS';
    }

    const strategy = options.filterRegistry.get(filterType);
    if (!strategy) {
      return;
    }

    // TYPE COERCION LAYER: Convert Unknown -> FilterValue
    const rawValue = filter.value;
    let safeInput: FilterValue | null = null;

    if (Array.isArray(rawValue)) {
      // Arrays are likely Ranges
      if (
        rawValue.length === 2 &&
        (typeof rawValue[0] === 'number' ||
          typeof rawValue[0] === 'string' ||
          rawValue[0] === null)
      ) {
        const min = toRangeValue(rawValue[0]);
        const max = toRangeValue(rawValue[1]);
        if (min !== null || max !== null) {
          safeInput = {
            type: 'range',
            value: [min as number | null, max as number | null],
          };
        }
      }
    } else if (typeof rawValue === 'string') {
      safeInput = { type: 'text', value: rawValue };
    } else if (typeof rawValue === 'number') {
      safeInput = { type: 'select', value: rawValue };
    }

    if (safeInput) {
      const clause = strategy({
        columnAccessor: sqlColumn,
        input: safeInput,
        columnId: filter.id,
      });

      if (clause) {
        clauses.push(clause);
      }
    }
  });

  return clauses;
}
