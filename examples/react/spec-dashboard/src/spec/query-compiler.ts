/**
 * The query compiler — the core bridge from a spec `query:` block to a Mosaic
 * `QuerySource` factory. Pure functions: spec in, `(ctx) => SelectQuery` out.
 *
 * Two forms (discriminated on `query.type`):
 *
 * - **Raw template** (`type: sql`): a SQL statement carrying `{{where}}` /
 *   `{{having}}` placeholders. At query time the incoming cross-filter
 *   predicates (`ctx.where` / `ctx.having`, mosaic-sql `ExprNode`s) are
 *   stringified to SQL text, substituted into the placeholders, and the whole
 *   statement is wrapped as a subquery — `SELECT * FROM (<statement>)` — so the
 *   rows client's `inputMode: 'append'` can still attach ORDER BY / LIMIT /
 *   OFFSET to the outer query. An empty/absent predicate renders as `TRUE`.
 *
 * - **Structured** (`type: select`): an alias→expression map over a base table
 *   compiled with `Query.from(from).select(...).where(ctx.where)`, plus optional
 *   static WHERE / GROUP BY / HAVING fragments. Simple column names and dotted
 *   struct paths route through the library's `SqlIdentifier` + `createStructAccess`;
 *   any other expression is embedded as a raw `sql` fragment.
 *
 * ## Predicate stringification (the load-bearing detail)
 *
 * `ctx.where` / `ctx.having` are `FilterExpr` — either an array of mosaic-sql
 * `ExprNode`s (`[]` when unfiltered) or a single node. {@link predicateToSql}
 * combines an array with `and(...)` (empty → renders as the empty string) and
 * `String()`-renders the node to SQL. An empty render becomes `TRUE`, so a
 * placeholder always substitutes into valid SQL.
 */
import { Query, and, sql } from '@uwdata/mosaic-sql';
import { SqlIdentifier, createStructAccess } from '@nozzleio/react-mosaic';
import type { ExprNode, FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type { QueryContext, QuerySource } from '@nozzleio/react-mosaic';
import type { QuerySpec, StructuredQuery } from './schema';

export const WHERE_PLACEHOLDER = '{{where}}';
export const HAVING_PLACEHOLDER = '{{having}}';

/** True when the raw template references the `{{where}}` placeholder. */
export function statementHasWherePlaceholder(statement: string): boolean {
  return statement.includes(WHERE_PLACEHOLDER);
}

/** True when the raw template references the `{{having}}` placeholder. */
export function statementHasHavingPlaceholder(statement: string): boolean {
  return statement.includes(HAVING_PLACEHOLDER);
}

/**
 * Stringify a cross-filter predicate to SQL. Arrays combine via `and(...)`; a
 * single node renders directly; an empty/absent predicate renders as `TRUE` so
 * substitution always produces valid SQL.
 */
export function predicateToSql(expr: FilterExpr | null | undefined): string {
  if (expr === null || expr === undefined) {
    return 'TRUE';
  }
  const combined = Array.isArray(expr) ? and(expr) : expr;
  const rendered = String(combined).trim();
  return rendered === '' ? 'TRUE' : rendered;
}

/** Matches a bare column name or a dotted struct path (no quotes, no calls). */
const SIMPLE_COLUMN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * A select expression → an `ExprNode`. Simple identifiers / dotted paths route
 * through the library's identifier + struct-access helpers (quoting each part);
 * anything else is trusted example SQL embedded verbatim as a `sql` fragment.
 */
export function columnExpr(expr: string): ExprNode {
  if (SIMPLE_COLUMN.test(expr)) {
    return createStructAccess(SqlIdentifier.from(expr));
  }
  return sql`${expr}`;
}

/**
 * Compile a raw-template statement into a query factory: substitute the
 * stringified predicates, then wrap the result as a subquery so the client can
 * append its own ORDER BY / LIMIT / OFFSET.
 */
export function compileRawTemplateQuery<TInputs extends object>(
  statement: string,
): QuerySource<TInputs> {
  return (ctx: QueryContext<TInputs>): SelectQuery => {
    const filled = statement
      .replaceAll(WHERE_PLACEHOLDER, predicateToSql(ctx.where))
      .replaceAll(HAVING_PLACEHOLDER, predicateToSql(ctx.having));
    return Query.from(sql`(${filled})`).select('*');
  };
}

/**
 * Compile the structured form into a query factory. Static `where` / `having`
 * fragments are trusted example SQL, ANDed alongside the cross-filter
 * predicates; `groupBy` columns route through the struct-access helper.
 */
export function compileStructuredQuery<TInputs extends object>(
  spec: StructuredQuery,
): QuerySource<TInputs> {
  return (ctx: QueryContext<TInputs>): SelectQuery => {
    const selection: Record<string, ExprNode> = {};
    for (const [alias, expr] of Object.entries(spec.select)) {
      selection[alias] = columnExpr(expr);
    }

    const query = Query.from(spec.from).select(selection).where(ctx.where);

    for (const fragment of spec.where ?? []) {
      query.where(sql`${fragment}`);
    }
    if (spec.group_by !== undefined && spec.group_by.length > 0) {
      query.groupby(...spec.group_by.map(columnExpr));
    }
    query.having(ctx.having);
    for (const fragment of spec.having ?? []) {
      query.having(sql`${fragment}`);
    }

    return query;
  };
}

/** Compile either query form into a `QuerySource` factory. */
export function compileQuery<TInputs extends object>(
  query: QuerySpec,
): QuerySource<TInputs> {
  if (query.type === 'sql') {
    return compileRawTemplateQuery<TInputs>(query.statement);
  }
  return compileStructuredQuery<TInputs>(query);
}
