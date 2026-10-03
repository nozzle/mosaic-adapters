/**
 * Subquery membership predicates: `column [NOT] IN (SELECT ...)`.
 *
 * Built on mosaic-sql's `InOpNode` + `ScalarSubqueryNode` (the canonical,
 * upstream-tested path for IN-subqueries). Selection clauses carrying these
 * predicates must be constructed with `createSubqueryClause` so they never
 * carry optimizer `meta` (see clause-factory.ts).
 *
 * Note that Mosaic's `filterPushdown` does not rewrite table references
 * inside scalar subqueries: a subquery predicate is NOT constrained by other
 * Selection clauses. Callers that need the subquery to react to sibling
 * filters must rebuild the predicate when those change (a FilterSet subquery
 * kind does this by embedding `args.contextPredicate` in the subquery WHERE).
 */
import * as mSql from '@uwdata/mosaic-sql';
import type { ExprNode, Query } from '@uwdata/mosaic-sql';

import { SqlIdentifier, identifierAccess } from './sql-access';
import type { ColumnPathMode } from './types';

/**
 * What a subquery factory may return:
 * - a mosaic-sql `Query` -> `column IN (<query>)`
 * - `{ query, negate: true }` -> `NOT (column IN (<query>))`
 * - `null` -> no predicate (the filter is cleared / inactive)
 */
export type SubqueryFilterQuery = Query | { query: Query; negate?: boolean } | null;

/** One outer column: a column name / dotted struct path, or a {@link SqlIdentifier}. */
export type SubqueryColumn = string | SqlIdentifier;

export interface BuildSubqueryPredicateOptions {
  /**
   * The outer column (or struct path "a.b") tested for membership. Pass an
   * array for a composite key: `['a', 'b']` renders `(a, b) IN (SELECT ...)`,
   * and the subquery must then select one column per entry, in order. A
   * one-element array is the same as passing that column alone.
   */
  column: SubqueryColumn | ReadonlyArray<SubqueryColumn>;
  /**
   * How a dotted string `column` (each entry, for a composite key) is read: a
   * struct path (`'struct'`, the default) or one identifier (`'literal'`, for
   * a column whose name contains a dot).
   */
  columnPaths?: ColumnPathMode;
  /** The membership subquery. Selects one column per outer column. */
  query: Query;
  /** When true, generates `NOT (column IN (...))`. */
  negate?: boolean;
}

/** Result of {@link buildSubqueryClauseParts}. */
export interface SubqueryClauseParts {
  /** The `column [NOT] IN (SELECT ...)` predicate. */
  predicate: ExprNode;
  /**
   * The expression tested for membership: the outer column node, or for a
   * composite key the `TupleNode` wrapping the column nodes.
   */
  field: ExprNode;
  /**
   * The outer column nodes the predicate references, one per column, as the
   * same instances embedded in `predicate`. Use this as the clause's `fields`.
   */
  fields: Array<ExprNode>;
}

function toColumnExpr(column: SubqueryColumn, columnPaths: ColumnPathMode | undefined): ExprNode {
  const accessor = typeof column === 'string' ? SqlIdentifier.from(column) : column;
  return identifierAccess(accessor, columnPaths);
}

function isColumnList(
  column: BuildSubqueryPredicateOptions['column'],
): column is ReadonlyArray<SubqueryColumn> {
  return Array.isArray(column);
}

/**
 * Builds a `column [NOT] IN (SELECT ...)` membership predicate together with
 * the outer column node(s) it references. Callers emitting a Selection clause
 * should use `fields` as the clause's `fields`: those are the same node
 * instances embedded in the predicate (Mosaic 0.29 field-identity
 * requirement).
 *
 * With several columns the predicate is a tuple test,
 * `(a, b) IN (SELECT a, b ...)`. A row whose tuple holds a NULL never
 * matches: against a nonempty subquery the test is unknown, so the row is
 * dropped, and with `negate` it is dropped too (`NOT unknown` is still
 * unknown). Against an empty subquery every test is false, so `negate` keeps
 * every row, NULL keys included. In DuckDB, a NULL in any
 * tuple the subquery returns also makes every non-matching row unknown, so a
 * negated test drops those rows; exclude NULL keys in the subquery to avoid it.
 *
 * Throws when `column` is an empty array.
 */
export function buildSubqueryClauseParts(
  options: BuildSubqueryPredicateOptions,
): SubqueryClauseParts {
  const { column, columnPaths, query, negate = false } = options;
  const columns = isColumnList(column) ? column : [column];
  if (columns.length === 0) {
    throw new Error('[mosaic-core] buildSubqueryClauseParts requires at least one column.');
  }

  const fields = columns.map((entry) => toColumnExpr(entry, columnPaths));
  const [single] = fields;
  const field = fields.length === 1 && single !== undefined ? single : new mSql.TupleNode(fields);

  const inPredicate = new mSql.InOpNode(field, new mSql.ScalarSubqueryNode(query));

  return {
    predicate: negate ? mSql.not(inPredicate) : inPredicate,
    field,
    fields,
  };
}

/**
 * Builds a `column [NOT] IN (SELECT ...)` membership predicate.
 */
export function buildSubqueryPredicate(options: BuildSubqueryPredicateOptions): ExprNode {
  return buildSubqueryClauseParts(options).predicate;
}

/**
 * Normalizes a subquery factory result to `{ query, negate }`, or `null`
 * when the factory opted out of producing a filter.
 */
export function normalizeSubqueryFilterQuery(
  result: SubqueryFilterQuery | undefined,
): { query: Query; negate: boolean } | null {
  if (result === null || result === undefined) {
    return null;
  }

  if (result instanceof mSql.Query) {
    return {
      query: result,
      negate: false,
    };
  }

  return {
    query: result.query,
    negate: result.negate ?? false,
  };
}
