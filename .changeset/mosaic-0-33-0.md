---
'@nozzleio/mosaic-core': minor
'@nozzleio/mosaic-tanstack-table-core': minor
'@nozzleio/mosaic-tanstack-react-table': minor
'@nozzleio/react-mosaic': minor
---

Support Mosaic 0.33.0. The `@uwdata/mosaic-core`, `@uwdata/mosaic-sql` and `@uwdata/vgplot` peer ranges are now `>=0.33.0 <1`, so apps must upgrade Mosaic to 0.33 alongside this release.

- `createTypedAccess` now builds its `TRY_CAST` with mosaic-sql's `tryCast()`, and `selectStarExclude` builds its clause with mosaic-sql's `star(null, { exclude })`. Both render the same SQL as before, and both exports keep their signatures.
- `selectStarExclude` now emits a real star node instead of an opaque SQL fragment, so Mosaic's pre-aggregation can follow it. Previously, a client reading through a `* EXCLUDE` subquery or CTE always used the standard query path. One shape now needs care: a filtered subquery or CTE with `ORDER BY … LIMIT` under an outer aggregate. Mosaic's optimizer lifts the active filter out of that subquery, and filtering does not commute with a top-k, so the result is wrong. This already applies to plain `select('*')` queries. Pass `filterStable: false` on clients with that shape; the rows client docs describe it under "Nested top-k".
- The `filterStable` warning now also reports `SELECT DISTINCT ON` (new in mosaic-sql 0.33) as a filter-unstable shape.
