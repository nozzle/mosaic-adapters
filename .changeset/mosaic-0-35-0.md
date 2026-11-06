---
'@nozzleio/mosaic-core': minor
'@nozzleio/mosaic-tanstack-table-core': minor
'@nozzleio/mosaic-tanstack-react-table': minor
'@nozzleio/react-mosaic': minor
---

Support Mosaic 0.35.0. The `@uwdata/mosaic-core`, `@uwdata/mosaic-sql` and `@uwdata/vgplot` peer ranges are now `>=0.35.0 <1`, so apps must upgrade Mosaic to 0.35.0 alongside this release. Mosaic 0.35 moves its in-browser connector to DuckDB 2.0 (`@duckdb/duckdb-wasm` 1.33.1-dev114.0).

- Array-column text operators (`columnType: 'array'`) now render their element test with DuckDB's `lambda x: …` syntax, e.g. `len(list_filter("tags", lambda x: x ILIKE '%beta%' ESCAPE '\')) > 0`. DuckDB 2.0 rejects the old `x -> …` arrow by default, so the previous SQL failed with a Binder Error. The `lambda` keyword needs DuckDB 1.3 or newer, which matters only if you run these predicates on your own (server-side) DuckDB.
- Composite-key membership subqueries (`buildSubqueryClauseParts` / `subqueryFilterKind` with several columns) follow DuckDB 2.0's standard SQL row comparison: a row that differs from every subquery tuple in a column where neither side is NULL now tests false instead of unknown, so `negate: true` keeps it. That covers both sides. A row whose own key holds a NULL (`(NULL, 'z')` against `(1, 'x')`) was always dropped by `negate: true` before and is now kept, and a NULL in a subquery tuple no longer makes every non-matching row unknown. Negated composite membership can therefore return more rows than before. The predicate SQL is unchanged; the membership docs describe the new rules.
