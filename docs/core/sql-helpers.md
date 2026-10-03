# mosaic-sql helpers (temporary)

`@uwdata/mosaic-sql` 0.32 is missing a few query-building pieces. Without them, apps write to private query fields or cast types, and those workarounds break on upgrades (0.32 already removed `Query.setCteFor`). `@nozzleio/mosaic-core` (and `@nozzleio/react-mosaic`, which re-exports it) ships small typed helpers for these gaps instead.

**These helpers are temporary.** Each one is removed, or becomes an alias, once mosaic-sql ships the equivalent. Some of them depend on mosaic-sql internals (`_with`, `_select`), so the package's tests pin the exact SQL each one renders. A mosaic-sql upgrade that changes those internals fails the tests instead of breaking your queries.

| Helper                                    | Gap it covers                                            | Renders                                 |
| ----------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| `withRecursive(query, name, body, opts?)` | No `WITH RECURSIVE`                                      | `WITH RECURSIVE "name" AS (…)`          |
| `selectStarExclude(query, columns)`       | No star `EXCLUDE`                                        | `SELECT * EXCLUDE ("a", "b")`           |
| `sqlFromParts(strings, ...values)`        | `sql` only accepts a `TemplateStringsArray`              | Same as the `sql` tag                   |
| `tableRef(...names)`                      | `TableRefNode` is exported, its `tableRef` helper is not | `"main"."events"`                       |
| `andOrTrue(...clauses)`                   | `and()` with no clauses renders an empty string          | `TRUE` when empty, otherwise like `and` |

## `withRecursive`

```ts
import { Query, literal, sql } from '@uwdata/mosaic-sql';
import { withRecursive } from '@nozzleio/mosaic-core';

const seed = Query.select({ n: literal(1) });
const step = Query.from('t')
  .select({ n: sql`n + 1` })
  .where(sql`n < 3`);

const query = withRecursive(Query.from('t').select('n'), 't', Query.unionAll(seed, step));
// WITH RECURSIVE "t" AS (SELECT 1 AS "n" UNION ALL SELECT n + 1 AS "n" FROM "t" WHERE n < 3)
// SELECT "n" FROM "t"
```

- It mutates and returns `query`, like `query.with()`.
- The CTE is appended after any CTEs the query already has, in order, because DuckDB does not let a CTE reference one declared after it. `RECURSIVE` applies to the whole WITH clause, so it is rendered once, before the first CTE.
- `options.materialized` (`true` / `false` / `null`, default `null`) and `options.columnNames` work like mosaic-sql's `cte()`.
- Every WITH entry keeps its `name` and `query`, so Mosaic's pre-aggregation lineage still sees the CTE as a CTE. The usual workaround, a custom node, hides the CTE from lineage, and the pre-aggregator then treats the CTE name as a base table. A CTE whose body only reads one base table can still be pre-aggregated. A self-referencing body has no single base table, so those clients use the standard query path.
- The recursive entry is a custom mosaic-sql node. mosaic-sql's generic `walk()` does not descend into its body. `deepClone()` does copy the body.

## `selectStarExclude`

```ts
selectStarExclude(Query.from('events'), ['payload', 'raw']);
// SELECT * EXCLUDE ("payload", "raw") FROM "events"
```

- The clause is appended to the SELECT list, like `query.select()`. The query is mutated and returned.
- Every name is quoted as an identifier, including `*`: `['*']` excludes a column literally named `*` and renders `EXCLUDE ("*")`. DuckDB rejects a name that is not in the FROM clause.
- Call it once per query. Unlike `query.select()`, it does not de-duplicate against earlier SELECT entries, so a second call (or a later `select('*')`) adds another star and repeats those columns.
- An empty list appends a plain `*`.
- Mosaic's pre-aggregation lineage only follows a plain `*`. A client that reads columns through a `* EXCLUDE` subquery or CTE therefore uses the standard query path.

## `sqlFromParts`

```ts
const columns = ['a', 'b', 'c'];
const parts = ['greatest(', ...columns.slice(1).map(() => ', '), ')'];
sqlFromParts(parts, ...columns.map((name) => column(name)));
// greatest("a", "b", "c")
```

This is the `sql` tag, typed for parts built at runtime. `strings` needs exactly one more entry than `values`. Otherwise it throws a `RangeError`. The value type is exported as `SqlTemplateValue`.

Values are interpolated exactly as the tag does it:

- Nodes (`column(…)`, `literal(…)`, other expressions) and params stay structured.
- Numbers, booleans and dates become SQL literals.
- **Strings are spliced in as raw SQL**, unquoted and unescaped. Never pass user or data strings directly: wrap them in `literal(value)` to get a quoted, escaped SQL string.

```ts
import { literal } from '@uwdata/mosaic-sql';

sqlFromParts(['name = ', ''], "O'Reilly"); // name = O'Reilly (raw SQL, invalid here)
sqlFromParts(['name = ', ''], literal("O'Reilly")); // name = 'O''Reilly'
```

## `tableRef`

```ts
tableRef('main', 'events'); // "main"."events"
tableRef(['main', 'events']); // same, arrays are flattened
tableRef('main.events'); // "main.events" (one identifier)
```

`tableRef` returns a `TableRefNode`, the same node as `new TableRefNode(['main', 'events'])`. Use it anywhere a client accepts a table reference as its `from` / query source (see [concepts](./concepts.md)). It throws if there are no names or a name is empty. The internal mosaic-sql helper returns `undefined` in that case.

## `andOrTrue`

```ts
andOrTrue(); // TRUE
andOrTrue(eq('a', 1)); // ("a" = 1)
andOrTrue(eq('a', 1), isNull('b')); // (("a" = 1) AND ("b" IS NULL))
```

The name is deliberately not `and`, so importing it never shadows mosaic-sql's own `and`.

mosaic-sql's `and()` with no clauses renders `''`. `query.where()` skips empty predicates, so that case is safe there. Anywhere else (`not(…)`, a `CASE WHEN`, a `sql` template) an empty `and()` produces broken SQL. `andOrTrue` returns `TRUE` instead, which is the identity for AND. Null clauses are dropped, as `and()` drops them. Only top-level emptiness is detected. A nested empty `and()` / `or()` passed as a clause still renders empty, and an empty OR is not dropped because it is not neutral.
