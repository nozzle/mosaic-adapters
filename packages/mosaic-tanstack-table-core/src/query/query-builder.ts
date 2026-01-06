import * as mSql from '@uwdata/mosaic-sql';
import { logger } from '../logger';
import { createStructAccess, toRangeValue } from '../utils';

import type { SelectQuery } from '@uwdata/mosaic-sql';
import type { RowData, TableState } from '@tanstack/table-core';
import type { ColumnMapper } from './column-mapper';
import type { StrategyRegistry } from '../registry';
import type { FilterStrategy } from './filter-factory';
import type { FilterInput, MosaicColumnMapping } from '../types';
import type { StrictId } from '../types/paths';

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
  const selectColumns = mapper.getSelectColumns().map(({ sql, alias }) => {
    const colStr = sql.toString();

    // Struct access: SELECT "a"."b" AS "alias"
    if (colStr.includes('.')) {
      const structExpr = createStructAccess(sql);
      return { [alias]: structExpr };
    }

    // Simple column aliasing
    if (alias !== colStr) {
      return { [alias]: mSql.column(colStr) };
    }

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
 * Extracts internal filters and converts weak TanStack state to Strong Types (FilterInput).
 * This logic now strictly parses the raw state based on the column's Mapping configuration.
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
    let mappingConfig;

    // 1. Try Strict Mapping
    if (options.mapping) {
      const key = filter.id as StrictId<TData>;
      mappingConfig = options.mapping[key];
      if (mappingConfig?.filterType) {
        filterType = mappingConfig.filterType;
      }
    }

    if (!mappingConfig) {
      // 2. Fallback to Meta (Deprecated)
      const colDef = options.mapper.getColumnDef(sqlColumn.toString());
      const metaType = colDef?.meta?.mosaicDataTable?.sqlFilterType;
      if (metaType) {
        filterType = metaType;
      }
    }

    const strategy = options.filterRegistry.get(filterType);
    if (!strategy) {
      return;
    }

    // TYPE COERCION LAYER: Convert Unknown -> Strict FilterInput
    const rawValue = filter.value;
    let safeInput: FilterInput | null = null;

    // Strict Mode: Use the configured filterType to dictate parsing logic
    if (filterType === 'RANGE') {
      if (Array.isArray(rawValue) && rawValue.length === 2) {
        const rawMin = toRangeValue(rawValue[0]);
        const rawMax = toRangeValue(rawValue[1]);

        // toRangeValue returns number | Date | null.
        // We strictly require numbers for the RANGE type.
        // If we get a Date, we treat it as null (invalid for numeric range).
        const minNum =
          typeof rawMin === 'number' && !isNaN(rawMin) ? rawMin : null;
        const maxNum =
          typeof rawMax === 'number' && !isNaN(rawMax) ? rawMax : null;

        // Valid if at least one bound exists
        if (minNum !== null || maxNum !== null) {
          safeInput = {
            mode: 'RANGE',
            value: [minNum, maxNum],
          };
        }
      }
    } else if (filterType === 'DATE_RANGE') {
      // Expect array of ISO strings
      // We trust the input is strings if the mapping says DATE_RANGE
      // (toRangeValue converts strings to Dates, so we don't use it here if we want raw ISO)
      if (
        Array.isArray(rawValue) &&
        rawValue.length === 2 &&
        (typeof rawValue[0] === 'string' || rawValue[0] === null) &&
        (typeof rawValue[1] === 'string' || rawValue[1] === null)
      ) {
        const minStr = rawValue[0] as string | null;
        const maxStr = rawValue[1] as string | null;
        if (minStr || maxStr) {
          safeInput = {
            mode: 'DATE_RANGE',
            value: [minStr, maxStr],
          };
        }
      }
    } else if (filterType === 'SELECT') {
      if (
        typeof rawValue === 'string' ||
        typeof rawValue === 'number' ||
        typeof rawValue === 'boolean'
      ) {
        safeInput = { mode: 'SELECT', value: rawValue };
      }
    } else if (
      filterType === 'ILIKE' ||
      filterType === 'LIKE' ||
      filterType === 'PARTIAL_ILIKE'
    ) {
      if (typeof rawValue === 'string') {
        safeInput = { mode: 'TEXT', value: rawValue };
      }
    } else if (filterType === 'EQUALS') {
      // EQUALS is flexible, maps to MATCH mode
      if (
        typeof rawValue === 'string' ||
        typeof rawValue === 'number' ||
        typeof rawValue === 'boolean'
      ) {
        safeInput = { mode: 'MATCH', value: rawValue };
      }
    } else {
      // Legacy Fallback
      if (Array.isArray(rawValue) && rawValue.length === 2) {
        // Assume number range for backward compat if legacy
        safeInput = {
          mode: 'RANGE',
          value: [Number(rawValue[0]) || null, Number(rawValue[1]) || null],
        };
      } else if (typeof rawValue === 'string') {
        safeInput = { mode: 'TEXT', value: rawValue };
      }
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
