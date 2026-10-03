---
'@nozzleio/mosaic-core': minor
---

Add temporary, typed helpers for gaps in `@uwdata/mosaic-sql` 0.32, so callers no longer write to private query fields or cast types. Each helper is removed or aliased once mosaic-sql ships the equivalent, and tests pin the SQL each one renders.

- New `withRecursive(query, name, body, options?)`: adds a CTE and renders the WITH clause as `WITH RECURSIVE`. Each CTE keeps its `name` and `query`, so Mosaic's pre-aggregation lineage still sees it as a CTE rather than a base table. `WithRecursiveOptions` (`materialized`, `columnNames`) is exported.
- New `selectStarExclude(query, columns)`: appends `* EXCLUDE ("a", "b")` to the SELECT list. An empty list appends a plain `*`.
- New `sqlFromParts(strings, ...values)`: the `sql` template tag, callable with parts built at runtime and without a `TemplateStringsArray` cast. `SqlTemplateValue` is exported.
- New `tableRef(...names)`: builds a `TableRefNode` (`tableRef('main', 'events')` renders `"main"."events"`) and throws on an empty list or name.
- New `andOrTrue(...clauses)`: mosaic-sql's `and()`, except an empty conjunction renders `TRUE` instead of an empty string.
