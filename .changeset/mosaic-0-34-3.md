---
'@nozzleio/mosaic-core': minor
'@nozzleio/mosaic-tanstack-table-core': minor
'@nozzleio/mosaic-tanstack-react-table': minor
'@nozzleio/react-mosaic': minor
---

Support Mosaic 0.34.3. The `@uwdata/mosaic-core`, `@uwdata/mosaic-sql` and `@uwdata/vgplot` peer ranges are now `>=0.34.3 <1`, so apps must upgrade Mosaic to 0.34.3 alongside this release.

- Multi-column point clauses use Mosaic's new tuple form. Row selections published by the rows client, and `points` FilterSet specs with a `{ columns, tuples }` value, now render `("a", "b") IN (("x", 1), ("y", 2))` instead of an `OR` of per-row `IS NOT DISTINCT FROM` conjunctions. Tuples that contain `NULL` are still matched explicitly, so the selected rows are unchanged.
- `coordinator.clear()` now also aborts in-flight connector queries (not `exec` statements), so a refetch after a clear sends a fresh request instead of joining the aborted one. A client whose current query is cleared still stays `'pending'` without an error.
- `selectStarExclude` still quotes an excluded column literally named `*` (`EXCLUDE ("*")`). mosaic-sql 0.34 would render it as the bare wildcard, so the helper now passes that entry as a custom node.
