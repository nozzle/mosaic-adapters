# @nozzleio/mosaic-core

## 0.3.0

### Minor Changes

- [#202](https://github.com/nozzle/mosaic-adapters/pull/202) [`bfd311c`](https://github.com/nozzle/mosaic-adapters/commit/bfd311ce04021cef18cf8d9cfc975933bd8384b4) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Histogram clients now accept `scale: 'linear' | 'log'`. Log-scaled histograms
  discover a positive extent and produce multiplicative bin boundaries, allowing
  custom renderers to align queried counts with a logarithmic visual axis.

## 0.2.1

### Patch Changes

- [#196](https://github.com/nozzle/mosaic-adapters/pull/196) [`33367fb`](https://github.com/nozzle/mosaic-adapters/commit/33367fba7ed50e915612e67570d83d19bf386207) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Fix crossfilter self-exclusion loss when a FilterSet-publishing client remounts. A client destroyed inside the deferred prepare/adopt window no longer re-keys the surviving clause to itself (guarded in the base client's `prepare` wrapper and in the rows/facet/histogram `#adoptFromSet` paths), and a freshly-adopted client now re-queries once its own clause is confirmed self-excluded on its filter context, so a remounted selection table no longer renders only its selected rows. Reproducible in production builds under fast unmount/remount, not just React StrictMode.

## 0.2.0

### Minor Changes

- [#167](https://github.com/nozzle/mosaic-adapters/pull/167) [`4771d10`](https://github.com/nozzle/mosaic-adapters/commit/4771d10e5053ba0d631f452efb005fc3eca1b9f7) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — complete rewrite.** `@nozzleio/mosaic-core` is now the framework-agnostic data-client core, and the entire legacy API is gone. Consumers upgrading from a prior version must migrate wholesale; nothing from the old surface is re-exported. The new core is built around a base `DataClient` over upstream `makeClient` that routes `filterBy` predicates to WHERE and `havingBy` predicates to HAVING, auto-requeries on Param changes, builds queries from a latest-ref factory, diffs serializable inputs before requerying, and exposes a `@tanstack/store` state of `{ status, error, inputs, lastQuery }`.

  - Purpose-built clients: `createRowsClient` (orderBy/limit/offset, window vs. query row counts, select/hover clause publishing with remount-stable `source` and struct-path `fields`, prefetch), `createValuesClient`, `createFacetClient` (array columns, multi-select), `createHistogramClient` (fixed-extent bins), `createSparklineClient` (batched per-key, date bins), `createRollupClient` + `rollupRowsToTree` (GROUP BY ROLLUP), `createPivotClient` (DuckDB PIVOT, dynamic columns), and `createSchemaClient`.
  - Filter-builder core (`filter-builder/*`), the filter registry (`createFilterRegistry`), and clause/subquery utilities: `updateClauseIfChanged`, `createSubqueryClause`, `createValueClause`, `createClearClause`, `buildSubqueryPredicate`, plus `deepEqual`.
  - Native filter routing helpers `routeFilter` / `applyRoutedFilters`.

  See `docs/core/*` for the full API.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`45c8273`](https://github.com/nozzle/mosaic-adapters/commit/45c82730099083274ecfefa4bf2d8271447e5cbd) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Adds `createFilterSet`, a page-level object that owns a set of serializable dashboard-filter intents (`FilterSpec`) and resolves each into per-target Selection clauses. Purely additive — no breaking changes.

  - Builder-registry kinds (`point`, `points`, `interval`, `match`, `condition`) resolve a spec into zero or more clause emissions; `conditionFilterKind(options)` and `subqueryFilterKind(build)` are factories for condition-style and `IN (SELECT ...)`-shaped kinds, and the registry is consumer-extensible via `FilterSetOptions.kinds`.
  - Named target Selections (`FilterSetOptions.targets`) with WHERE/HAVING routing per emission, derived chips for an active-filter bar, and external-clear mirroring (chip bar / `selection.reset()` removes the owning spec).
  - Subquery context rebuilds: an optional `context` Selection feeds `contextPredicate` into context-dependent kinds and triggers a microtask-debounced re-publish on change.
  - Whole-set persistence via a single `Persister<FilterSpec[]>` entry (`FilterSetOptions.persist`); hydration replays each spec resiliently and never writes back.
  - New `publish: { into, id }` form on the facet, histogram, and rows clients — an alternative to `publish: { as }` that routes a widget's interaction into a `FilterSet` instead of a raw Selection, preserving widget mirror and self-exclusion semantics.

  See `docs/core/filter-set.md`.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`7be04e4`](https://github.com/nozzle/mosaic-adapters/commit/7be04e475f942761e17d2bc83d62af91d4e65cf7) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — filter-builder and filter-registry deleted.** Both subsystems are subsumed by `FilterSet` and the builder-registry kinds; chips now read the set directly.

  - Removed: the entire `filter-builder/*` surface (`FilterDefinition`, value-kind and operator registries, `FilterBindingController`, condition-predicate helpers) and `filter-registry.ts` (`createFilterRegistry` and its chip types).
  - Migrate declarative filter definitions and bindings to `createFilterSet` + builder-registry kinds (`point`, `points`, `interval`, `match`, `condition`); migrate chip consumption to the set's derived chips.
  - `sql-access` and `subquery-predicate` exports are unaffected (relocated in e5b3941, unchanged here).

  See `docs/core/filter-set.md`.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`2f5702c`](https://github.com/nozzle/mosaic-adapters/commit/2f5702c1f19dca55f7f4fa3dec82e7535b194ae4) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Adds a generic persistence contract for filter _intent_ (never resolved SQL clauses): `Persister<TState>`, with `PersisterWriteReason` (`'update' | 'clear' | 'external'`) and `PersisterWriteContext`.

  - New `persist` option on the facet, histogram, and rows clients. A synchronous `read` hydrates before the first query (no flash, no extra query); a thenable `read` hydrates on resolve and accepts a re-query. Writes are per-entry; hydration itself is never written back, and destroy-time clause cleanup never persists.
  - External clause removals (chip bar, `selection.reset()`) now write with reason `'external'`.
  - New replay setters: `facet.setSelected(values)` and `rows.setSelectedValues(tuples)`, for restoring stored intent where the original row objects no longer exist.
  - The rows client now mirrors external clears of its select clause into its internal tuple tracking — previously untracked.

  See `docs/core/concepts.md#persistence`.

### Patch Changes

- [#177](https://github.com/nozzle/mosaic-adapters/pull/177) [`981a59f`](https://github.com/nozzle/mosaic-adapters/commit/981a59f6745282e2cc1c49df169316fc84222a58) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - build(deps): upgrade dependencies to their latest eligible versions.

  Notably `@tanstack/store` and `@tanstack/react-store` move to `^0.11.0` (from `^0.9.1`) — no API changes. All other bumps are build tooling and dev dependencies (no change to published runtime surface). TypeScript moves to the `6.0.x` line.

- [#179](https://github.com/nozzle/mosaic-adapters/pull/179) [`db5138b`](https://github.com/nozzle/mosaic-adapters/commit/db5138b57bad77ca9866c7052af6f4b2caebb761) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix(core): the `'date'` coerce descriptor now scales microsecond-epoch bigints to milliseconds. Parquet/DuckDB `TIMESTAMP` columns surface as µs bigints; without the magnitude check they decoded to a far-future date (~year 57000). A bigint past ~year 2286 in ms is now treated as µs and divided by 1000 before constructing the `Date`.
