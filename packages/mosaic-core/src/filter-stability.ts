/**
 * Static checks behind the rows client's "defaulted `filterStable`" warning.
 *
 * `filterStable: true` (upstream's default) promises Mosaic's pre-aggregation
 * optimizer that filtering cannot change which groups a client query produces.
 * These helpers decide (1) whether Mosaic 0.32's `PreAggregator` could engage
 * on a query at all, and (2) whether the query has a shape that usually breaks
 * the promise. Both are heuristics behind a console warning — they never
 * change behaviour.
 */
import {
  FromClauseNode,
  JoinNode,
  collectAggregates,
  isPivotQuery,
  isQuery,
  isSelectQuery,
  isSetOperation,
  walk,
} from '@uwdata/mosaic-sql';
import type { ExprNode, Query, SQLNode, SelectQuery } from '@uwdata/mosaic-sql';

/** A query shape that usually lets filtering change the group domain. */
export interface FilterUnstableShape {
  /** Human-readable clause name, e.g. `GROUP BY` or `a window function`. */
  clause: string;
  /** True when the shape sits in a FROM subquery, CTE or set operation member. */
  nested: boolean;
}

/**
 * Matches window-function calls inside unparsed SQL text, mirroring the private
 * `windowRegExp` upstream `isAggregateExpression` uses (`) OVER (` or
 * `) OVER name`). Keep it, and `stripSubqueryText`, in step with
 * `@uwdata/mosaic-sql`'s visitors when the Mosaic peer range is bumped.
 */
const WINDOW_TEXT = /\)\s*over(\s*\(|\s+[\w"])/;

/**
 * True when Mosaic's pre-aggregation could engage on `query`: upstream
 * `preaggColumns` only optimizes a SELECT query whose outer SELECT / HAVING /
 * QUALIFY / ORDER BY contains a structured, non-window aggregate. Anything
 * else (plain row lists, set operations, a `count(*) OVER ()` wrapper) always
 * takes the standard query path, so `filterStable` is irrelevant for it.
 *
 * Deliberately conservative: upstream additionally requires the query to
 * resolve to a single base table, which is not checked here, so an aggregate
 * over a JOIN or a multi-entry FROM still counts as pre-aggregatable (a
 * warn-side false positive at worst).
 */
export function canPreAggregate(query: unknown): boolean {
  if (!isSelectQuery(query)) {
    return false;
  }
  const exprs: Array<ExprNode> = [
    ...query._select.map((clause) => clause.expr),
    ...query._having,
    ...query._qualify,
    ...query._orderby,
  ];
  return exprs.some((expr) => collectAggregates(expr).length > 0);
}

/**
 * Finds the first filter-unstable shape in `query`: GROUP BY, SELECT DISTINCT,
 * QUALIFY, window functions (in SELECT or ORDER BY) or PIVOT — in the query itself, its CTEs
 * (`Query.with()`), FROM subqueries (including join sides) and set operation
 * members. Predicate subqueries (`IN (SELECT ...)`, scalar subqueries) are not
 * inspected: they come from filter clauses and do not shape the row domain.
 * Returns null when none is found.
 */
export function findFilterUnstableShape(query: unknown): FilterUnstableShape | null {
  return visitQuery(query, false, new Set());
}

function visitQuery(
  query: unknown,
  nested: boolean,
  seen: Set<unknown>,
): FilterUnstableShape | null {
  if (!isQuery(query) || seen.has(query)) {
    return null;
  }
  seen.add(query);

  const own = ownShape(query);
  if (own !== null) {
    return { clause: own, nested };
  }

  for (const cte of query._with) {
    const found = visitQuery(cte.query, true, seen);
    if (found !== null) {
      return found;
    }
  }

  for (const relation of relationsOf(query)) {
    const found = visitRelation(relation, seen);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/** The clause name of a filter-unstable shape on `query` itself, else null. */
function ownShape(query: Query): string | null {
  if (isPivotQuery(query)) {
    return 'PIVOT';
  }
  if (!isSelectQuery(query)) {
    return null;
  }
  if (query._groupby.length > 0) {
    return 'GROUP BY';
  }
  if (query._distinct) {
    return 'SELECT DISTINCT';
  }
  if (query._qualify.length > 0) {
    return 'QUALIFY';
  }
  if (hasWindowFunction(query)) {
    return 'a window function';
  }
  return null;
}

/** The row sources of a query: FROM entries, or set operation members. */
function relationsOf(query: Query): Array<SQLNode> {
  if (isSelectQuery(query)) {
    return query._from;
  }
  if (isSetOperation(query)) {
    return query.queries;
  }
  return [];
}

function visitRelation(node: SQLNode, seen: Set<unknown>): FilterUnstableShape | null {
  if (node instanceof JoinNode) {
    return visitRelation(node.left, seen) ?? visitRelation(node.right, seen);
  }
  if (node instanceof FromClauseNode) {
    return visitRelation(node.expr, seen);
  }
  return visitQuery(node, true, seen);
}

/**
 * True when the SELECT list or ORDER BY uses a window function (a structured
 * `WindowNode`, or `... OVER (...)` inside `sql` / verbatim text) or the query
 * declares a named WINDOW. Those are the clauses where a window shapes which
 * rows the query returns (ORDER BY together with a LIMIT, say). WHERE and
 * HAVING are not inspected — a window is invalid in either — and QUALIFY is
 * reported as its own clause. Scalar subqueries are not descended into.
 */
function hasWindowFunction(query: SelectQuery): boolean {
  if (query._window.length > 0) {
    return true;
  }
  if (query._select.some((clause) => exprHasWindow(clause.expr))) {
    return true;
  }
  return query._orderby.some((expr) => exprHasWindow(expr));
}

function exprHasWindow(expr: ExprNode): boolean {
  // An object, not a `let`: the walk callback mutates it out of band.
  const state = { found: false };
  walk(expr, (node) => {
    if (state.found) {
      return -1;
    }
    if (node.type === 'WINDOW') {
      state.found = true;
      return -1;
    }
    if (node.type === 'SCALAR_SUBQUERY') {
      return 1;
    }
    if (node.type === 'FRAGMENT' || node.type === 'VERBATIM') {
      if (WINDOW_TEXT.test(stripSubqueryText(String(node).toLowerCase()))) {
        state.found = true;
        return -1;
      }
      // Rendered text covers any nested nodes; do not descend.
      return 1;
    }
    return undefined;
  });
  return state.found;
}

/** Drop embedded `(select ...)` text, as upstream's verbatim analysis does. */
function stripSubqueryText(text: string): string {
  const start = text.indexOf('(select ');
  if (start < 0) {
    return text;
  }
  return text.slice(0, start);
}
