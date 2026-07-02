---
'@nozzleio/mosaic-core': minor
---

**BREAKING — complete rewrite.** `@nozzleio/mosaic-core` is now the framework-agnostic data-client core, and the entire legacy API is gone. Consumers upgrading from a prior version must migrate wholesale; nothing from the old surface is re-exported. The new core is built around a base `DataClient` over upstream `makeClient` that routes `filterBy` predicates to WHERE and `havingBy` predicates to HAVING, auto-requeries on Param changes, builds queries from a latest-ref factory, diffs serializable inputs before requerying, and exposes a `@tanstack/store` state of `{ status, error, inputs, lastQuery }`.

- Purpose-built clients: `createRowsClient` (orderBy/limit/offset, window vs. query row counts, select/hover clause publishing with remount-stable `source` and struct-path `fields`, prefetch), `createValuesClient`, `createFacetClient` (array columns, multi-select), `createHistogramClient` (fixed-extent bins), `createSparklineClient` (batched per-key, date bins), `createRollupClient` + `rollupRowsToTree` (GROUP BY ROLLUP), `createPivotClient` (DuckDB PIVOT, dynamic columns), and `createSchemaClient`.
- Filter-builder core (`filter-builder/*`), the filter registry (`createFilterRegistry`), and clause/subquery utilities: `updateClauseIfChanged`, `createSubqueryClause`, `createValueClause`, `createClearClause`, `buildSubqueryPredicate`, plus `deepEqual`.
- Native filter routing helpers `routeFilter` / `applyRoutedFilters`.

See `docs/core/*` for the full API.
