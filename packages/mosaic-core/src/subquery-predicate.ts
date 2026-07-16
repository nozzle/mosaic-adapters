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
import { SqlIdentifier, createStructAccess } from './sql-access';

import type { ExprNode, Query } from '@uwdata/mosaic-sql';

/**
 * What a subquery factory may return:
 * - a mosaic-sql `Query` -> `column IN (<query>)`
 * - `{ query, negate: true }` -> `NOT (column IN (<query>))`
 * - `null` -> no predicate (the filter is cleared / inactive)
 */
export type SubqueryFilterQuery =
  | Query
  | { query: Query; negate?: boolean }
  | null;

export interface BuildSubqueryPredicateOptions {
  /** The outer column (or struct path "a.b") tested for membership. */
  column: string | SqlIdentifier;
  /** The membership subquery. Should select a single column. */
  query: Query;
  /** When true, generates `NOT (column IN (...))`. */
  negate?: boolean;
}

/**
 * Builds a `column [NOT] IN (SELECT ...)` membership predicate together with
 * the outer column node it references. Callers emitting a Selection clause
 * should use `field` as the clause's `fields` entry so it is the same node
 * instance embedded in the predicate (Mosaic 0.29 field-identity requirement).
 */
export function buildSubqueryClauseParts(
  options: BuildSubqueryPredicateOptions,
): { predicate: ExprNode; field: ExprNode } {
  const { column, query, negate = false } = options;
  const columnAccessor =
    typeof column === 'string' ? SqlIdentifier.from(column) : column;
  const columnExpr = createStructAccess(columnAccessor);

  const inPredicate = new mSql.InOpNode(
    columnExpr,
    new mSql.ScalarSubqueryNode(query),
  );

  return {
    predicate: negate ? mSql.not(inPredicate) : inPredicate,
    field: columnExpr,
  };
}

/**
 * Builds a `column [NOT] IN (SELECT ...)` membership predicate.
 */
export function buildSubqueryPredicate(
  options: BuildSubqueryPredicateOptions,
): ExprNode {
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
