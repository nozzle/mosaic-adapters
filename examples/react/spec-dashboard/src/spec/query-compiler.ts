/**
 * The query compiler — the core bridge from a spec `query:` block to a Mosaic
 * `QuerySource` factory. Pure functions: spec in, `(ctx) => SelectQuery` out.
 *
 * One form, **structured** (`type: select`): an alias→expression map over a base
 * table compiled with `Query.from(from).select(...).where(ctx.where)`, plus
 * optional static WHERE / GROUP BY / HAVING fragments. Simple column names and
 * dotted struct paths route through the library's `SqlIdentifier` +
 * `createStructAccess`; any other expression is embedded as a raw `sql` fragment.
 *
 * ## Fragment-level variable binding
 *
 * Inside a raw SQL fragment (a `where` / `having` entry, a non-simple `select`
 * expression, or a `group_by` entry) two sigils bind a declared `variable`
 * (a topology-owned Mosaic Param). Both match ONLY against the declared-variable
 * NAME set — an incidental `$` / `:` in trusted SQL is never a token:
 *
 * - `$name` — a COLUMN reference: the variable's value NAMES a column. Splices a
 *   `column(param)` (a `ColumnParamNode`) into the fragment, quoted as an
 *   identifier at codegen (`quoteIdentifier`, double-quotes; a non-string value
 *   string-coerces — `5` → `"5"`). This extends the whole-expression `$name`
 *   semantics into SQL fragments and `group_by`.
 * - `:name` — a VALUE placeholder: the variable's value interpolates as an
 *   escaped SQL literal. Splices the raw `Param` into the fragment (a `ParamNode`),
 *   rendered via `literalToSQL` (single-quote-escaped) at codegen.
 *
 * Splitting the author's fragment on the tokens and interpolating the nodes
 * between the verbatim pieces is injection-safe: the variable value never reaches
 * SQL text unescaped. {@link scanFragmentTokens} owns the grammar (reused by
 * cross-reference validation, so the two never diverge).
 */
import { Query, column, sql } from '@uwdata/mosaic-sql';
import { SqlIdentifier, createStructAccess } from '@nozzleio/react-mosaic';
import type { ExprNode, ParamLike, SelectQuery } from '@uwdata/mosaic-sql';
import type { QueryContext, QuerySource } from '@nozzleio/react-mosaic';
import type { StructuredQuery } from './schema';

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
 * as the data hook's `params`, so a variable change re-queries the client. A
 * query that binds no variable has an empty `variables`.
 */
export interface CompiledQuery<TInputs extends object> {
  source: QuerySource<TInputs>;
  variables: ReadonlyArray<string>;
}

/** Matches a bare column name or a dotted struct path (no quotes, no calls). */
const SIMPLE_COLUMN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** The always-empty declared-variable set (a fragment with no bindable tokens). */
const NO_DECLARED_VARIABLES: ReadonlySet<string> = new Set();

/**
 * One bindable fragment token: a `$name` (column) or `:name` (value) whose
 * `name` is a declared variable. `start`/`end` are the half-open span of the
 * whole token (sigil + name) in the source fragment, so the fragment can be
 * split on them.
 */
export interface FragmentToken {
  /** `$name` → the value NAMES a column; `:name` → the value is an escaped literal. */
  kind: 'column' | 'value';
  /** The declared-variable name (guaranteed a member of the declared set). */
  name: string;
  start: number;
  end: number;
}

/**
 * A candidate token: a `$` (column) or `:` (value) sigil immediately followed by
 * an identifier. The identifier group is greedy over word chars, so the char
 * AFTER a match is inherently a non-word char — the "char after not `\w`" rule is
 * satisfied by the pattern itself, and `:minute` never partial-matches a declared
 * `min` (it captures `minute`, which is not in the declared set). Boundary BEFORE
 * the sigil and declared-set membership are checked per match in
 * {@link scanFragmentTokens}.
 */
const FRAGMENT_TOKEN = /([$:])([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Scan a raw SQL fragment for bindable `$name` / `:name` tokens, matched ONLY
 * against `declared` (the declared-variable name set) — the primary guard, so an
 * incidental `$` / `:` in trusted example SQL is never claimed. This is the SINGLE
 * grammar source: the fragment compiler and cross-reference validation both scan
 * through here, so what the compiler binds and what validation checks cannot
 * diverge.
 *
 * Per-match rules (mirroring the sigils' SQL neighbors):
 * - `$name` — the char BEFORE `$` must not be a word char or `$` (immunizes a
 *   `$$` dollar-quote and an `a$b`; a `$1` / `$5.00` never starts an identifier);
 * - `:name` — the char BEFORE `:` must not be `:` or a word char (immunizes a
 *   `::CAST` and an `a:b` label);
 * - the char AFTER the name is inherently non-word (the greedy identifier group).
 */
export function scanFragmentTokens(
  fragment: string,
  declared: ReadonlySet<string>,
): Array<FragmentToken> {
  const tokens: Array<FragmentToken> = [];
  if (declared.size === 0) {
    return tokens;
  }
  // A fresh regex per call keeps `lastIndex` local — the module-level literal is
  // `/g`, so sharing it across calls would be reentrancy-unsafe.
  const scanner = new RegExp(FRAGMENT_TOKEN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(fragment)) !== null) {
    const sigil = match[1]!;
    const name = match[2]!;
    if (!declared.has(name)) {
      continue;
    }
    const before = match.index === 0 ? '' : fragment[match.index - 1]!;
    if (sigil === '$' && /[\w$]/.test(before)) {
      continue;
    }
    if (sigil === ':' && /[:\w]/.test(before)) {
      continue;
    }
    tokens.push({
      kind: sigil === '$' ? 'column' : 'value',
      name,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

/**
 * Compile a raw SQL fragment to an `ExprNode`, binding any `$name` / `:name`
 * tokens (see {@link scanFragmentTokens}). A fragment with NO tokens compiles to
 * `sql`${fragment}`` — byte-identical to the pre-binding behavior (a single
 * verbatim span). With tokens, the fragment is split on their spans and rebuilt
 * through the `sql` tag with a `column(param)` (for `$name`) or the raw `Param`
 * (for `:name` → a `ParamNode`) spliced between the verbatim pieces. A token
 * with no resolver is a programming error (validation admits fragment tokens only
 * where a resolver is threaded), surfaced as a throw.
 */
function compileFragment(
  fragment: string,
  declared: ReadonlySet<string>,
  resolveVariable?: VariableResolver,
): ExprNode {
  const tokens = scanFragmentTokens(fragment, declared);
  if (tokens.length === 0) {
    return sql`${fragment}`;
  }
  if (resolveVariable === undefined) {
    throw new Error(
      `fragment '${fragment}' binds a variable but was compiled without a variable resolver.`,
    );
  }
  // Split the fragment into verbatim pieces around the tokens; splice a node for
  // each token between the pieces. `strings.length === exprs.length + 1`, the
  // shape the `sql` tag consumes.
  const strings: Array<string> = [];
  const exprs: Array<ExprNode | ParamLike> = [];
  let cursor = 0;
  for (const token of tokens) {
    strings.push(fragment.slice(cursor, token.start));
    exprs.push(
      token.kind === 'column'
        ? // `$name`: the value NAMES a column (quoted identifier).
          column(resolveVariable(token.name))
        : // `:name`: the value is an escaped literal (a `ParamNode`).
          resolveVariable(token.name),
    );
    cursor = token.end;
  }
  strings.push(fragment.slice(cursor));
  // `sql` only indexes `strings` (never reads `.raw`), so a plain array is safe.
  return sql(strings as unknown as TemplateStringsArray, ...exprs);
}

/**
 * The declared-variable names one select / group_by expression references, in
 * source order. Mirrors {@link columnExpr}'s routing so the two never disagree:
 * a whole-expression `$name` ref, a simple column (none), or a fragment's tokens.
 */
function columnExprRefs(
  expr: string,
  declared: ReadonlySet<string>,
): Array<string> {
  const whole = parseVariableRef(expr);
  if (whole !== null) {
    return [whole];
  }
  if (SIMPLE_COLUMN.test(expr)) {
    return [];
  }
  return scanFragmentTokens(expr, declared).map((token) => token.name);
}

/**
 * A select (or `group_by`) expression → an `ExprNode`. In order:
 *
 * - a bare `$name` variable ref → `column(param)` (a `ColumnParamNode`): the
 *   variable's value NAMES the column, quoted as an identifier at codegen. This
 *   is the metric-switch case — `resolveVariable` supplies the live `Param`, and
 *   {@link compileStructuredQuery} records the dependency so the widget re-queries
 *   on change. A ref with no resolver is a programming error (validation only
 *   admits refs where a resolver is threaded), surfaced as a throw.
 * - a simple identifier / dotted path → the library's identifier + struct-access
 *   helpers (quoting each part);
 * - anything else → a trusted example SQL fragment, binding any `$name` / `:name`
 *   tokens whose name is in `declared` (see {@link compileFragment}); a fragment
 *   with no such token is embedded verbatim, exactly as before.
 */
export function columnExpr(
  expr: string,
  resolveVariable?: VariableResolver,
  declared: ReadonlySet<string> = NO_DECLARED_VARIABLES,
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
  return compileFragment(expr, declared, resolveVariable);
}

/**
 * Collect the declared-variable names a structured query references across EVERY
 * bindable position — whole-expression + fragment `select` values, `group_by`
 * entries, and `where` / `having` fragments — in a stable de-duplicated order.
 *
 * Correctness-critical: this is the set the widget hands the client as `params`,
 * so a ref the compiler binds but this misses would leave the client without the
 * Param and silently stale. Both sides route through the SAME per-position
 * helpers ({@link columnExprRefs} / {@link scanFragmentTokens}) as the compiler,
 * so they cannot diverge.
 */
function structuredQueryVariables(
  spec: StructuredQuery,
  declared: ReadonlySet<string>,
): Array<string> {
  const names: Array<string> = [];
  const add = (found: Array<string>): void => {
    for (const name of found) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  };
  for (const expr of Object.values(spec.select)) {
    add(columnExprRefs(expr, declared));
  }
  for (const expr of spec.group_by ?? []) {
    add(columnExprRefs(expr, declared));
  }
  for (const fragment of spec.where ?? []) {
    add(scanFragmentTokens(fragment, declared).map((token) => token.name));
  }
  for (const fragment of spec.having ?? []) {
    add(scanFragmentTokens(fragment, declared).map((token) => token.name));
  }
  return names;
}

/**
 * Compile the structured form into a {@link CompiledQuery}. Static `where` /
 * `having` fragments are trusted example SQL, ANDed alongside the cross-filter
 * predicates; `groupBy` columns route through the struct-access helper. Every raw
 * fragment position (`select` expressions, `where` / `having` fragments, and
 * `group_by` entries) binds any `$name` / `:name` tokens naming a declared
 * variable (see {@link compileFragment}); a whole-expression `$name` select /
 * group_by entry compiles to a `column(param)` (the variable's value names the
 * column). The referenced names are recorded on the result so the widget can pass
 * them as the hook's `params`.
 *
 * `declaredVariables` is the declared-variable name set the token scanner matches
 * against (empty by default — then only whole-expression `$name` refs bind, the
 * pre-fragment behavior). Threading `resolveVariable` into `group_by` also fixes a
 * latent crash: a bare `$name` group_by entry used to throw at query-build time
 * because no resolver reached the `columnExpr` call.
 */
export function compileStructuredQuery<TInputs extends object>(
  spec: StructuredQuery,
  resolveVariable?: VariableResolver,
  declaredVariables: ReadonlySet<string> = NO_DECLARED_VARIABLES,
): CompiledQuery<TInputs> {
  const source = (ctx: QueryContext<TInputs>): SelectQuery => {
    const selection: Record<string, ExprNode> = {};
    for (const [alias, expr] of Object.entries(spec.select)) {
      selection[alias] = columnExpr(expr, resolveVariable, declaredVariables);
    }

    const query = Query.from(spec.from).select(selection).where(ctx.where);

    for (const fragment of spec.where ?? []) {
      query.where(
        compileFragment(fragment, declaredVariables, resolveVariable),
      );
    }
    if (spec.group_by !== undefined && spec.group_by.length > 0) {
      query.groupby(
        ...spec.group_by.map((expr) =>
          columnExpr(expr, resolveVariable, declaredVariables),
        ),
      );
    }
    query.having(ctx.having);
    for (const fragment of spec.having ?? []) {
      query.having(
        compileFragment(fragment, declaredVariables, resolveVariable),
      );
    }

    return query;
  };
  return {
    source,
    variables: structuredQueryVariables(spec, declaredVariables),
  };
}
