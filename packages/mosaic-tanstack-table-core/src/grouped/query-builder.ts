/**
 * @file Query builder and selection predicate generator for server-side grouped tables.
 *
 * Generates GROUP BY queries at each depth level and compound WHERE predicates
 * for cross-filter selection. Returns `SelectQuery` objects (not strings) —
 * callers call `.toString()` at the boundary when passing to `coordinator.query()`.
 */
import * as mSql from '@uwdata/mosaic-sql';
import type { ExprValue, FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { GroupLevel, GroupMetric, GroupedRow, LeafColumn } from './types';

// ---------------------------------------------------------------------------
// Query Building
// ---------------------------------------------------------------------------

export interface BuildGroupedLevelQueryOptions {
  /** The table (or view) name to query. */
  table: string;

  /** The full hierarchy of group columns. */
  groupBy: Array<GroupLevel>;

  /** Which depth level to query (0 = root). */
  depth: number;

  /**
   * Aggregation metrics to compute at this level.
   * Each metric becomes a SELECT expression.
   */
  metrics: Array<GroupMetric>;

  /**
   * Ancestor constraints — maps column names to literal values
   * that restrict this query to a specific parent group.
   *
   * @example { complaint_type: 'Noise' }  // for depth=1 query
   */
  parentConstraints: Record<string, string>;

  /** Filter predicate from the Mosaic Selection (cross-filter context). */
  filterPredicate?: FilterExpr | null;

  /** Additional static WHERE clauses (e.g., NULL exclusion). */
  additionalWhere?: FilterExpr | null;

  /** Maximum rows to return per level. Defaults to 200. */
  limit?: number;

  /** Sort metric id to order results by. Defaults to first metric. */
  orderByMetric?: string;
}

/**
 * Builds a GROUP BY query for a specific depth level in the hierarchy.
 *
 * @example
 * // Level 0: root complaint types
 * buildGroupedLevelQuery({
 *   table: 'nyc_311',
 *   groupBy: [{ column: 'complaint_type' }, { column: 'descriptor' }],
 *   depth: 0,
 *   metrics: [{ id: 'count', expression: mSql.count() }],
 *   parentConstraints: {},
 * });
 * // → SELECT complaint_type, COUNT(*) as count
 * //   FROM nyc_311
 * //   GROUP BY complaint_type
 * //   ORDER BY count DESC
 */
export function buildGroupedLevelQuery(
  options: BuildGroupedLevelQueryOptions,
): SelectQuery {
  const {
    table,
    groupBy,
    depth,
    metrics,
    parentConstraints,
    filterPredicate,
    additionalWhere,
    limit = 200,
    orderByMetric,
  } = options;

  if (depth < 0 || depth >= groupBy.length) {
    throw new Error(
      `[buildGroupedLevelQuery] depth ${depth} out of range [0, ${groupBy.length - 1}]`,
    );
  }

  const level = groupBy[depth]!;
  const groupCol = mSql.column(level.column);

  // Build SELECT: group column + all metrics
  const selects: Record<string, ExprValue> = {
    [level.column]: groupCol,
  };

  for (const metric of metrics) {
    selects[metric.id] = metric.expression;
  }

  const q = mSql.Query.from(table).select(selects).groupby(groupCol);

  // Apply parent constraints (ancestor WHERE clauses)
  const whereClauses: Array<FilterExpr> = [];

  for (const [col, val] of Object.entries(parentConstraints)) {
    whereClauses.push(mSql.eq(mSql.column(col), mSql.literal(val)));
  }

  // Apply Mosaic filter predicate
  if (filterPredicate) {
    whereClauses.push(filterPredicate);
  }

  // Apply additional static WHERE
  if (additionalWhere) {
    whereClauses.push(additionalWhere);
  }

  if (whereClauses.length > 0) {
    q.where(
      whereClauses.length === 1 ? whereClauses[0]! : mSql.and(...whereClauses),
    );
  }

  // Order by metric descending (most common groups first)
  const sortMetric = orderByMetric ?? metrics[0]?.id;
  if (sortMetric) {
    q.orderby(mSql.desc(mSql.column(sortMetric)));
  }

  if (limit > 0) {
    q.limit(limit);
  }

  return q;
}

// ---------------------------------------------------------------------------
// Leaf Row Query Building
// ---------------------------------------------------------------------------

export interface BuildLeafRowsQueryOptions {
  /** The table (or view) name to query. */
  table: string;

  /** Columns to fetch for leaf rows. */
  leafColumns: Array<LeafColumn>;

  /**
   * Constraints for all parent group columns.
   * Maps column names to literal values.
   *
   * @example { complaint_type: 'Noise', descriptor: 'Loud Music', resolution_description: 'Resolved' }
   */
  parentConstraints: Record<string, string>;

  /** Filter predicate from the Mosaic Selection (cross-filter context). */
  filterPredicate?: FilterExpr | null;

  /** Additional static WHERE clauses (e.g., NULL exclusion). */
  additionalWhere?: FilterExpr | null;

  /** Maximum rows to return. Defaults to 100. */
  limit?: number;

  /** Column to order by. Defaults to first leafColumn. */
  orderBy?: string;

  /** Order direction. Defaults to 'desc'. */
  orderDir?: 'asc' | 'desc';

  /** When true, SELECT * instead of only named leafColumns. */
  selectAll?: boolean;
}

/**
 * Builds a SELECT query for raw leaf rows (no GROUP BY).
 *
 * Used when expanding the deepest grouped level to show actual data rows.
 */
export function buildLeafRowsQuery(
  options: BuildLeafRowsQueryOptions,
): SelectQuery {
  const {
    table,
    leafColumns,
    parentConstraints,
    filterPredicate,
    additionalWhere,
    limit = 100,
    orderBy,
    orderDir = 'desc',
    selectAll = false,
  } = options;

  if (!selectAll && leafColumns.length === 0) {
    throw new Error(
      '[buildLeafRowsQuery] leafColumns must not be empty when selectAll is false',
    );
  }

  // Always build with named columns — the Query builder cannot produce
  // a bare `SELECT *` (it wraps every expression with an alias).
  const selects: Record<string, ExprValue> = {};
  for (const col of leafColumns) {
    selects[col.column] = mSql.column(col.column);
  }

  const q = mSql.Query.from(table).select(selects);

  // Apply parent constraints (full ancestry WHERE clauses)
  const whereClauses: Array<FilterExpr> = [];

  for (const [col, val] of Object.entries(parentConstraints)) {
    whereClauses.push(mSql.eq(mSql.column(col), mSql.literal(val)));
  }

  // Apply Mosaic filter predicate
  if (filterPredicate) {
    whereClauses.push(filterPredicate);
  }

  // Apply additional static WHERE
  if (additionalWhere) {
    whereClauses.push(additionalWhere);
  }

  if (whereClauses.length > 0) {
    q.where(
      whereClauses.length === 1 ? whereClauses[0]! : mSql.and(...whereClauses),
    );
  }

  // Order by specified column or first leaf column
  const sortCol = orderBy ?? leafColumns[0]?.column;
  if (sortCol) {
    const orderExpr =
      orderDir === 'asc'
        ? mSql.asc(mSql.column(sortCol))
        : mSql.desc(mSql.column(sortCol));
    q.orderby(orderExpr);
  }

  if (limit > 0) {
    q.limit(limit);
  }

  if (selectAll) {
    // The Query builder always aliases SELECT expressions, making `SELECT *`
    // impossible via its API. Build with named columns for correct WHERE/ORDER/
    // LIMIT, then swap the column list for `*` in the output string.
    const sql = q.toString();
    const starSql = sql.replace(/^SELECT .+? FROM /, 'SELECT * FROM ');
    return { toString: () => starSql } as SelectQuery;
  }

  return q;
}

// ---------------------------------------------------------------------------
// Selection Predicate Building
// ---------------------------------------------------------------------------

/**
 * Builds a compound SQL predicate for a selected grouped row.
 *
 * The predicate includes all ancestor constraints plus the row's own value,
 * enabling cross-filtering at any depth in the hierarchy.
 *
 * @example
 * // Selecting a level-1 row ("Loud Music" under "Noise")
 * const row = {
 *   _groupColumn: 'descriptor',
 *   _groupValue: 'Loud Music',
 *   _parentValues: { complaint_type: 'Noise' },
 * };
 * buildGroupedSelectionPredicate(row);
 * // → AND(complaint_type = 'Noise', descriptor = 'Loud Music')
 */
export function buildGroupedSelectionPredicate(
  row: Pick<GroupedRow, '_groupColumn' | '_groupValue' | '_parentValues'>,
): FilterExpr {
  const clauses: Array<FilterExpr> = [];

  // Parent constraints (ancestors)
  for (const [col, val] of Object.entries(row._parentValues)) {
    clauses.push(mSql.eq(mSql.column(col), mSql.literal(val)));
  }

  // Own value
  clauses.push(
    mSql.eq(mSql.column(row._groupColumn), mSql.literal(row._groupValue)),
  );

  return clauses.length === 1 ? clauses[0]! : mSql.and(...clauses);
}

/**
 * Builds a combined predicate for multiple selected rows (OR of compound predicates).
 *
 * Used for multi-select scenarios where rows at different depths can be selected.
 */
export function buildGroupedMultiSelectionPredicate(
  rows: Array<
    Pick<GroupedRow, '_groupColumn' | '_groupValue' | '_parentValues'>
  >,
): FilterExpr | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length === 1) {
    return buildGroupedSelectionPredicate(rows[0]!);
  }

  const predicates = rows.map((r) => buildGroupedSelectionPredicate(r));
  return mSql.or(...predicates);
}
