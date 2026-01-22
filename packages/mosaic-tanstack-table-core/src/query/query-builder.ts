/**
 * Core logic for translating TanStack Table state into Mosaic SQL queries.
 * This module strictly adheres to configured mappings to prevent ambiguous SQL generation.
 * It handles the translation of UI state (Pagination, Sorting, Filtering) into
 * a coherent SQL Select Query AST.
 */

import * as mSql from '@uwdata/mosaic-sql';
import { logger } from '../logger';
import { createStructAccess, toRangeValue } from '../utils';

import type { SelectQuery } from '@uwdata/mosaic-sql';
import type { RowData, TableState } from '@tanstack/table-core';
import type { ColumnMapper } from './column-mapper';
import type { StrategyRegistry } from '../registry';
import type { FilterStrategy } from './filter-factory';
import type { FilterInput, MosaicColumnMapping } from '../types';

export interface QueryBuilderOptions<TData extends RowData, TValue = unknown> {
  source: string | SelectQuery;
  tableState: TableState;
  mapper: ColumnMapper<TData, TValue>;
  mapping: MosaicColumnMapping<TData> | undefined; // Enforce explicit undefined if missing
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
    // Only log the SQL string. The context (filters, sort, pagination) is fully
    // encapsulated within the SQL string itself (WHERE, ORDER BY, LIMIT).
    // This reduces token usage significantly by removing redundant object dumps.
    { sql: statement.toString() },
  );

  return statement;
}

/**
 * Extracts internal filters and converts weak TanStack state to Strong Types (FilterInput).
 * This logic strictly parses the raw state based on the column's Mapping configuration.
 * Ambiguous inputs without explicit configuration are ignored to ensure type safety.
 * Handles type coercion from UI inputs (strings, numbers) to strict FilterInputs.
 */
export function extractInternalFilters<TData extends RowData, TValue>(options: {
  tableState: TableState;
  mapper: ColumnMapper<TData, TValue>;
  mapping: MosaicColumnMapping<TData> | undefined; // Enforce explicit undefined if missing
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
      // Use logger instead of console.warn to lower noise level
      logger.warn(
        'Core',
        `[QueryBuilder] Skipping filter for ID "${filter.id}". No matching SQL column found in mapper.`,
      );
      return;
    }

    const rawValue = filter.value;

    // DYNAMIC OVERRIDE:
    // If the UI passed a full FilterInput object (which has a 'mode'), use that mode
    // to determine the strategy, ignoring the static column config.
    if (
      typeof rawValue === 'object' &&
      rawValue !== null &&
      'mode' in rawValue
    ) {
      const dynamicMode = (rawValue as any).mode;
      const strategy = options.filterRegistry.get(dynamicMode);

      if (strategy) {
        logger.debug(
          'Core',
          `[QueryBuilder] Executing Dynamic Strategy: ${dynamicMode} for ${filter.id}`,
          rawValue,
        );

        const clause = strategy({
          columnAccessor: sqlColumn,
          input: rawValue as FilterInput,
          columnId: filter.id,
        });
        if (clause) {
          clauses.push(clause);
        }
        return; // Continue to next filter
      } else {
        logger.warn(
          'Core',
          `[QueryBuilder] Dynamic Strategy NOT FOUND: ${dynamicMode}`,
        );
      }
    }

    // Resolve Configuration
    let filterType: string | undefined;
    let filterOptions;

    // 1. Try Strict Mapping
    if (options.mapping) {
      const key = filter.id;
      const mappingConfig = options.mapping[key];
      if (mappingConfig?.filterType) {
        filterType = mappingConfig.filterType;
      }
      if (mappingConfig?.filterOptions) {
        filterOptions = mappingConfig.filterOptions;
      }
    }

    // 2. Fallback to Meta (if mapping not present)
    if (!filterType) {
      const colDef = options.mapper.getColumnDef(sqlColumn.toString());
      const metaType = colDef?.meta?.mosaicDataTable?.sqlFilterType;
      if (metaType) {
        filterType = metaType;
      }
    }

    // Strict Mode Enforcement:
    // We do not fallback to guessing types based on values.
    // If no filter configuration exists, we warn and skip.
    if (!filterType) {
      logger.warn(
        'Core',
        `[QueryBuilder] Filter ignored for column "${filter.id}". No 'filterType' defined in mapping or column meta.`,
      );
      return;
    }

    const strategy = options.filterRegistry.get(filterType);
    if (!strategy) {
      logger.warn(
        'Core',
        `[QueryBuilder] Unknown filter strategy "${filterType}" for column "${filter.id}".`,
      );
      return;
    }

    // TYPE COERCION LAYER: Convert Unknown -> Strict FilterInput
    let safeInput: FilterInput | null = null;

    switch (filterType) {
      case 'RANGE':
        // Numeric Range: Expects [number | null, number | null]
        if (Array.isArray(rawValue) && rawValue.length === 2) {
          const rawMin = toRangeValue(rawValue[0]);
          const rawMax = toRangeValue(rawValue[1]);

          const minNum =
            typeof rawMin === 'number' && !isNaN(rawMin) ? rawMin : null;
          const maxNum =
            typeof rawMax === 'number' && !isNaN(rawMax) ? rawMax : null;

          if (minNum !== null || maxNum !== null) {
            safeInput = {
              mode: 'RANGE',
              value: [minNum, maxNum],
            };
          }
        }
        break;

      case 'DATE_RANGE':
        // Date Range: Expects [string | null, string | null] (ISO strings preferred)
        if (Array.isArray(rawValue) && rawValue.length === 2) {
          const minVal = rawValue[0];
          const maxVal = rawValue[1];

          // Coerce valid items to strings, leave nulls/undefined as null.
          // Explicitly treat empty strings as null to handle browser input behavior.
          const minStr =
            minVal !== null && minVal !== undefined && minVal !== ''
              ? String(minVal)
              : null;
          const maxStr =
            maxVal !== null && maxVal !== undefined && maxVal !== ''
              ? String(maxVal)
              : null;

          // Explicit null check required to support single-sided (open) ranges
          if (minStr !== null || maxStr !== null) {
            safeInput = {
              mode: 'DATE_RANGE',
              value: [minStr, maxStr],
            };
          }
        }
        break;

      case 'SELECT':
      case 'MATCH':
      case 'EQUALS':
        // Equality checks: Allow primitives
        if (
          typeof rawValue === 'string' ||
          typeof rawValue === 'number' ||
          typeof rawValue === 'boolean'
        ) {
          safeInput = { mode: 'MATCH', value: rawValue };
        }
        break;

      case 'ILIKE':
      case 'LIKE':
      case 'PARTIAL_ILIKE':
      case 'PARTIAL_LIKE':
        // Text Search: Strictly strings
        if (typeof rawValue === 'string') {
          safeInput = { mode: 'TEXT', value: rawValue };
        }
        break;

      default:
        // Attempt to guess text for unhandled custom types
        if (typeof rawValue === 'string') {
          safeInput = { mode: 'TEXT', value: rawValue };
        } else {
          logger.warn(
            'Core',
            `[QueryBuilder] Unhandled filter coercion for configured type: ${filterType}`,
          );
        }
        break;
    }

    if (safeInput) {
      const clause = strategy({
        columnAccessor: sqlColumn,
        input: safeInput,
        columnId: filter.id,
        filterOptions,
      });

      if (clause) {
        clauses.push(clause);
      }
    }
  });

  return clauses;
}
