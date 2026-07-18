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
import { Query, and, column, sql } from '@uwdata/mosaic-sql';
import { SqlIdentifier, createStructAccess } from '@nozzleio/react-mosaic';
import type {
  ExprNode,
  FilterExpr,
  ParamLike,
  SelectQuery,
} from '@uwdata/mosaic-sql';
import type { QueryContext, QuerySource } from '@nozzleio/react-mosaic';
import type { QuerySpec, StructuredQuery } from './schema';

export const WHERE_PLACEHOLDER = '{{where}}';
export const HAVING_PLACEHOLDER = '{{having}}';

/**
 * The variable-reference sigil: a whole expression that is exactly `$name`
 * (matching upstream Mosaic's spec convention for referencing a Param). Only a
 * bare `$identifier` occupying the ENTIRE trimmed expression is a variable ref —
 * so a raw SQL fragment that merely contains a `$` (a positional `$1`, a `$$`
 * dollar-quote, a `$5.00` literal) is never mistaken for one. See
 * {@link parseVariableRef}.
 */
const VARIABLE_REF = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;

/**
 * The declared-variable name a spec expression references, or `null` when the
 * expression is not a bare `$name` variable ref. Whitespace-tolerant. This is
 * the single source of truth for the reference grammar — the query compiler, the
 * plot interpreter, and cross-reference validation all parse refs through it.
 */
export function parseVariableRef(expr: string): string | null {
  const match = VARIABLE_REF.exec(expr.trim());
  return match === null ? null : match[1]!;
}

/**
 * Resolve a declared variable NAME to its live Mosaic `Param` (a `ParamLike`).
 * Injected into the compiler by the widget (which owns topology access), so the
 * compiler stays pure — spec + resolver in, factory out. The name is always one
 * cross-reference validation already proved is a declared variable, so a correct
 * resolver never fails here.
 */
export type VariableResolver = (name: string) => ParamLike;

/**
 * A compiled query: the `QuerySource` factory plus the declared-variable names it
 * binds (a `$name` ref in a structured column position → a `column(param)` in the
 * AST). The consuming widget passes the same names — resolved to their Params —
 * as the data hook's `params`, so a variable change re-queries the client. The
 * raw-template path never binds variables (see {@link compileRawTemplateQuery}),
 * so its `variables` is always empty.
 */
export interface CompiledQuery<TInputs extends object> {
  source: QuerySource<TInputs>;
  variables: ReadonlyArray<string>;
}

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
 * A select expression → an `ExprNode`. In order:
 *
 * - a bare `$name` variable ref → `column(param)` (a `ColumnParamNode`): the
 *   variable's value NAMES the column, quoted as an identifier at codegen. This
 *   is the metric-switch case — `resolveVariable` supplies the live `Param`, and
 *   {@link compileStructuredQuery} records the dependency so the widget re-queries
 *   on change. A ref with no resolver is a programming error (validation only
 *   admits refs where a resolver is threaded), surfaced as a throw.
 * - a simple identifier / dotted path → the library's identifier + struct-access
 *   helpers (quoting each part);
 * - anything else → trusted example SQL embedded verbatim as a `sql` fragment.
 */
export function columnExpr(
  expr: string,
  resolveVariable?: VariableResolver,
): ExprNode {
  const variable = parseVariableRef(expr);
  if (variable !== null) {
    if (resolveVariable === undefined) {
      throw new Error(
        `variable ref '${expr}' cannot be compiled without a variable resolver.`,
      );
    }
    return column(resolveVariable(variable));
  }
  if (SIMPLE_COLUMN.test(expr)) {
    return createStructAccess(SqlIdentifier.from(expr));
  }
  return sql`${expr}`;
}

/**
 * Compile a raw-template statement into a query factory: substitute the
 * stringified predicates, then wrap the result as a subquery so the client can
 * append its own ORDER BY / LIMIT / OFFSET. Raw SQL is opaque text — a variable
 * cannot bind into it (cross-reference validation rejects a `$name` matching a
 * declared variable inside a raw statement), so this path binds no variables.
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
 * Collect the declared-variable names a structured select references, in a
 * stable de-duplicated order. Group-by / where / having fragments never carry
 * variables (only the alias→expression `select` map admits a `$name` ref), so
 * only `select` is scanned.
 */
function structuredQueryVariables(spec: StructuredQuery): Array<string> {
  const names: Array<string> = [];
  for (const expr of Object.values(spec.select)) {
    const variable = parseVariableRef(expr);
    if (variable !== null && !names.includes(variable)) {
      names.push(variable);
    }
  }
  return names;
}

/**
 * Compile the structured form into a {@link CompiledQuery}. Static `where` /
 * `having` fragments are trusted example SQL, ANDed alongside the cross-filter
 * predicates; `groupBy` columns route through the struct-access helper. A `$name`
 * select expression compiles to a `column(param)` (the variable's value names the
 * column); the referenced names are recorded on the result so the widget can pass
 * them as the hook's `params`.
 */
export function compileStructuredQuery<TInputs extends object>(
  spec: StructuredQuery,
  resolveVariable?: VariableResolver,
): CompiledQuery<TInputs> {
  const source = (ctx: QueryContext<TInputs>): SelectQuery => {
    const selection: Record<string, ExprNode> = {};
    for (const [alias, expr] of Object.entries(spec.select)) {
      selection[alias] = columnExpr(expr, resolveVariable);
    }

    const query = Query.from(spec.from).select(selection).where(ctx.where);

    for (const fragment of spec.where ?? []) {
      query.where(sql`${fragment}`);
    }
    if (spec.group_by !== undefined && spec.group_by.length > 0) {
      query.groupby(...spec.group_by.map((expr) => columnExpr(expr)));
    }
    query.having(ctx.having);
    for (const fragment of spec.having ?? []) {
      query.having(sql`${fragment}`);
    }

    return query;
  };
  return { source, variables: structuredQueryVariables(spec) };
}

/**
 * Compile either query form into a {@link CompiledQuery}. `resolveVariable` is
 * required only when the (structured) query references a variable; the raw-template
 * path ignores it and binds no variables.
 */
export function compileQuery<TInputs extends object>(
  query: QuerySpec,
  resolveVariable?: VariableResolver,
): CompiledQuery<TInputs> {
  if (query.type === 'sql') {
    return {
      source: compileRawTemplateQuery<TInputs>(query.statement),
      variables: [],
    };
  }
  return compileStructuredQuery<TInputs>(query, resolveVariable);
}
