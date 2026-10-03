/**
 * Temporary helpers for gaps in `@uwdata/mosaic-sql` 0.32.
 *
 * Each helper covers one thing mosaic-sql does not offer yet. Without them,
 * callers write to private query fields or cast types, and those workarounds
 * break on upgrades (0.32 already removed `Query.setCteFor`). The helpers keep
 * that dependency in one place, and `tests/sql-helpers.test.ts` pins the SQL
 * each one renders, so a mosaic-sql upgrade that changes the internals fails
 * loudly there instead of in an app.
 *
 * TEMPORARY: each helper is removed, or becomes an alias, once mosaic-sql
 * ships the equivalent. Keep these minimal; don't grow them into a SQL layer.
 */
import {
  SelectClauseNode,
  TableRefNode,
  WithClauseNode,
  and,
  deepClone,
  isQuery,
  literal,
  sql,
} from '@uwdata/mosaic-sql';
import type {
  ExprNode,
  ExprVarArgs,
  FragmentNode,
  Query,
  SQLCodeGenerator,
  SelectQuery,
} from '@uwdata/mosaic-sql';

/** A value interpolated by mosaic-sql's `sql` tag (and {@link sqlFromParts}). */
export type SqlTemplateValue = Parameters<typeof sql>[1];

/**
 * mosaic-sql's extension point: its code generator hands a node with this
 * type back to the node's own `toString(visitor)`.
 */
const CUSTOM_NODE_TYPE = 'CUSTOM';

/**
 * The first entry of a WITH clause that renders `RECURSIVE "name" AS (…)`.
 *
 * mosaic-sql 0.32 always renders a WITH clause as `WITH <entries>` and has no
 * RECURSIVE flag. DuckDB reads `WITH RECURSIVE` as a property of the whole
 * clause, so prefixing the first entry is enough.
 *
 * It is still a `WithClauseNode` with a real `name` and `query`, so Mosaic's
 * pre-aggregation lineage (which reads `name` / `query` from each `_with`
 * entry) still sees the CTE as a CTE, not as a base table. `Query.with()` also
 * keeps the instance, because it checks `instanceof WithClauseNode`.
 *
 * The node is `CUSTOM`-typed so the code generator calls its `toString`.
 * mosaic-sql's generic traversal (`walk`, `deepClone`) does not descend into
 * custom nodes, so `clone()` deep-clones the body itself. Otherwise Mosaic's
 * pre-aggregator would mutate the original body when it pushes columns down
 * into a cloned query.
 */
class RecursiveWithClauseNode extends WithClauseNode {
  override readonly type: string = CUSTOM_NODE_TYPE;

  override clone(): this {
    const copy = new RecursiveWithClauseNode(
      this.name,
      deepClone(this.query),
      this.materialized,
      this.columnNames.slice(),
    );
    // The constructor builds exactly this class; `this` is only wider when
    // someone subclasses this private class, which nothing does.
    return copy as this;
  }

  override toString(visitor?: SQLCodeGenerator): string {
    const plain = new WithClauseNode(this.name, this.query, this.materialized, this.columnNames);
    return `RECURSIVE ${plain.toString(visitor)}`;
  }
}

/** Options for {@link withRecursive}. */
export interface WithRecursiveOptions {
  /**
   * The CTE materialization flag, as in mosaic-sql's `cte()`: `true` renders
   * `AS MATERIALIZED`, `false` renders `AS NOT MATERIALIZED`, and `null` (the
   * default) leaves the decision to the database.
   */
  materialized?: boolean | null;
  /** Column name aliases for the CTE (`"name"("a", "b") AS (…)`). */
  columnNames?: ReadonlyArray<string>;
}

/**
 * Adds a recursive common table expression to `query` and renders its WITH
 * clause as `WITH RECURSIVE`. Mutates and returns `query`, like mosaic-sql's
 * own `query.with()`.
 *
 * The CTE is appended after any existing CTEs, in order, because DuckDB does
 * not let a CTE reference one declared after it. The `RECURSIVE` keyword
 * applies to the whole clause, so it is rendered once, on the first entry;
 * the first existing CTE is re-wrapped to carry it, with the same name and
 * query.
 *
 * Every entry keeps its `name` and `query`, so Mosaic's pre-aggregation
 * lineage still resolves the CTE. A self-referencing body has no single base
 * table, so pre-aggregation backs off to the standard query path for it.
 *
 * TEMPORARY: covers the missing `WITH RECURSIVE` support in mosaic-sql 0.32.
 * It is removed or aliased once mosaic-sql can render recursive CTEs.
 *
 * @example
 * ```ts
 * const seed = Query.select({ n: literal(1) });
 * const step = Query.from('t').select({ n: sql`n + 1` }).where(sql`n < 3`);
 * const query = withRecursive(Query.from('t').select('n'), 't', Query.unionAll(seed, step));
 * // WITH RECURSIVE "t" AS (SELECT 1 AS "n" UNION ALL SELECT n + 1 AS "n" FROM "t" WHERE n < 3) SELECT "n" FROM "t"
 * ```
 */
export function withRecursive<Q extends Query>(
  query: Q,
  name: string,
  body: Query,
  options: WithRecursiveOptions = {},
): Q {
  if (!isQuery(query)) {
    throw new TypeError('[withRecursive] `query` must be a mosaic-sql Query.');
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('[withRecursive] `name` must be a non-empty string.');
  }
  if (!isQuery(body)) {
    throw new TypeError(`[withRecursive] The body of CTE "${name}" must be a mosaic-sql Query.`);
  }

  const { materialized = null, columnNames = [] } = options;
  const entries = [
    ...query._with,
    new WithClauseNode(name, body, materialized, columnNames.slice()),
  ];
  query._with = entries.map((entry, index) => {
    if (index > 0) {
      return entry;
    }
    if (entry instanceof RecursiveWithClauseNode) {
      return entry;
    }
    return new RecursiveWithClauseNode(
      entry.name,
      entry.query,
      entry.materialized,
      entry.columnNames,
    );
  });
  return query;
}

/**
 * Appends `* EXCLUDE ("a", "b")` to the SELECT list of `query`: every column
 * except the named ones. Mutates and returns `query`, like `query.select()`.
 * Every name is quoted as an identifier, including `*` (a column literally
 * named `*`). With an empty list it appends a plain `*`, through mosaic-sql's
 * own `select('*')`.
 *
 * Call it once per query. Unlike `select()`, it does not de-duplicate
 * against earlier SELECT entries, so a second call (or a `select('*')`)
 * adds another star and the result repeats those columns.
 *
 * Mosaic's pre-aggregation lineage only follows a plain `*`, so a query that
 * reads a column through `* EXCLUDE` from a subquery or CTE takes the
 * standard (non-pre-aggregated) query path. That is the conservative outcome.
 *
 * TEMPORARY: covers the missing star `EXCLUDE` support in mosaic-sql 0.32.
 * mosaic-sql's `select()` would render a node as `<expr> AS "<expr>"`, so this
 * appends to the query's `_select` list directly. It is removed or aliased
 * once mosaic-sql can render star exclusions.
 *
 * @example
 * ```ts
 * selectStarExclude(Query.from('events'), ['payload', 'raw']);
 * // SELECT * EXCLUDE ("payload", "raw") FROM "events"
 * ```
 */
export function selectStarExclude<Q extends SelectQuery>(
  query: Q,
  columns: ReadonlyArray<string>,
): Q {
  for (const name of columns) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError('[selectStarExclude] Every excluded column must be a non-empty string.');
    }
  }
  if (columns.length === 0) {
    return query.select('*');
  }

  // Quote names here rather than through `column()`: mosaic-sql's code
  // generator renders a column named `*` as a bare wildcard, which would
  // turn `EXCLUDE ("*")` into `EXCLUDE (*)`.
  const excluded = columns.map(quoteIdentifier).join(', ');
  const expr = sqlFromParts([`* EXCLUDE (${excluded})`]);
  query._select = query._select.concat(new SelectClauseNode(expr, ''));
  return query;
}

/**
 * Quotes `name` as a SQL identifier, doubling any embedded double quotes.
 * Same rules as mosaic-sql's internal `quoteIdentifier`, which it does not
 * export, but with no wildcard special case.
 */
function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * mosaic-sql's `sql` template tag, callable with parts built at runtime:
 * `strings` holds the literal SQL between the values, so it needs exactly one
 * more entry than `values`. Values are interpolated exactly as the tag does:
 * nodes and params stay structured; numbers, booleans and dates become SQL
 * literals; and **strings are spliced in as raw SQL**, unquoted and unescaped.
 * Wrap string data in `literal(value)` to get a quoted SQL string, otherwise
 * `"O'Reilly"` renders as invalid (or injectable) SQL.
 *
 * TEMPORARY: `sql` is typed to take a `TemplateStringsArray`, so a programmatic
 * call needs a cast. This wrapper is removed or aliased once mosaic-sql ships a
 * typed entry point for it.
 *
 * @example
 * ```ts
 * sqlFromParts(['coalesce(', ', ', ')'], column('a'), 0);
 * // coalesce("a", 0)
 * sqlFromParts(['name = ', ''], literal("O'Reilly"));
 * // name = 'O''Reilly'
 * ```
 */
export function sqlFromParts(
  strings: ReadonlyArray<string>,
  ...values: Array<SqlTemplateValue>
): FragmentNode {
  if (strings.length !== values.length + 1) {
    throw new RangeError(
      `[sqlFromParts] Expected ${values.length + 1} string parts for ` +
        `${values.length} values, received ${strings.length}.`,
    );
  }
  for (const part of strings) {
    if (typeof part !== 'string') {
      throw new TypeError('[sqlFromParts] Every string part must be a string.');
    }
  }
  const parts = [...strings];
  const template: TemplateStringsArray = Object.assign(parts, { raw: parts.slice() });
  return sql(template, ...values);
}

/**
 * Builds a mosaic-sql table reference: `tableRef('main', 'events')` renders
 * `"main"."events"`. Like mosaic-sql's internal `tableRef`, nested arrays are
 * flattened, so `tableRef(['main', 'events'])` is the same reference. A single
 * name is always one identifier: `tableRef('main.events')` renders
 * `"main.events"`.
 *
 * Unlike the internal helper, which returns `undefined` for no names, this
 * throws on an empty list or an empty name, so the result is always a
 * `TableRefNode`.
 *
 * TEMPORARY: mosaic-sql 0.32 exports `TableRefNode` but not its `tableRef`
 * helper. This is removed or aliased once mosaic-sql exports it.
 */
export function tableRef(...names: ReadonlyArray<string | ReadonlyArray<string>>): TableRefNode {
  const parts = names.flat();
  if (parts.length === 0) {
    throw new TypeError('[tableRef] Expected at least one table name.');
  }
  for (const part of parts) {
    if (typeof part !== 'string' || part.length === 0) {
      throw new TypeError('[tableRef] Every table name part must be a non-empty string.');
    }
  }
  return new TableRefNode(parts);
}

/**
 * mosaic-sql's `and()`, except that a conjunction with no clauses renders
 * `TRUE` instead of an empty string. Null and undefined clauses are dropped,
 * as `and()` drops them.
 *
 * `and()` with no clauses is fine in `query.where()`, which skips empty
 * predicates, but it produces broken SQL anywhere else: `NOT ()`,
 * `CASE WHEN  THEN …`, or an empty slot in a `sql` template. `TRUE` is the
 * identity for AND, so this is always safe to embed.
 *
 * Only top-level emptiness is detected: a nested empty `and()` / `or()` passed
 * as a clause still renders empty. (An empty OR is not neutral, so it is not
 * dropped.)
 *
 * TEMPORARY: covers mosaic-sql 0.32 rendering an empty `and()` as `''`. It is
 * removed or aliased once mosaic-sql renders an empty conjunction as `TRUE`.
 */
export function andOrTrue(...clauses: Array<ExprVarArgs>): ExprNode {
  const conjunction = and(...clauses);
  if (conjunction.clauses.length === 0) {
    return literal(true);
  }
  return conjunction;
}
