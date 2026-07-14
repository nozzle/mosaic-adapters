# @nozzleio/mosaic-tanstack-table-core

## 0.9.4

### Patch Changes

- Updated dependencies [[`72d551d`](https://github.com/nozzle/mosaic-adapters/commit/72d551dce5b0c47f5f7625595521918a69c70581)]:
  - @nozzleio/mosaic-core@0.4.0

## 0.9.3

### Patch Changes

- Updated dependencies [[`870c794`](https://github.com/nozzle/mosaic-adapters/commit/870c794ad58c1a62f8472dced2ee265c26c27525), [`74ef2a7`](https://github.com/nozzle/mosaic-adapters/commit/74ef2a73d3349430a224c30cee9d06586301542f), [`07aae12`](https://github.com/nozzle/mosaic-adapters/commit/07aae12f262b044e6d30ddc04f7e9ba7a7093f3c), [`b7d6a27`](https://github.com/nozzle/mosaic-adapters/commit/b7d6a273092525fb83d2a9fde5b1a96062c4d66c), [`c6cc739`](https://github.com/nozzle/mosaic-adapters/commit/c6cc7397c36f8e4e360d1ec5bdbe60f515b812c2)]:
  - @nozzleio/mosaic-core@0.3.1

## 0.9.2

### Patch Changes

- Updated dependencies [[`bfd311c`](https://github.com/nozzle/mosaic-adapters/commit/bfd311ce04021cef18cf8d9cfc975933bd8384b4)]:
  - @nozzleio/mosaic-core@0.3.0

## 0.9.1

### Patch Changes

- Updated dependencies [[`33367fb`](https://github.com/nozzle/mosaic-adapters/commit/33367fba7ed50e915612e67570d83d19bf386207)]:
  - @nozzleio/mosaic-core@0.2.1

## 0.9.0

### Minor Changes

- [#192](https://github.com/nozzle/mosaic-adapters/pull/192) [`0c42068`](https://github.com/nozzle/mosaic-adapters/commit/0c42068fcb75fa7625bd73528846ca91d8aa2361) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Rename the filter-bridge APIs to name TanStack Table explicitly (not the
  umbrella "TanStack" brand):

  - `@nozzleio/mosaic-tanstack-react-table`: `useTanStackFilterBridge` →
    `useTanStackTableFilterBridge` (and `UseTanStackFilterBridgeOptions` →
    `UseTanStackTableFilterBridgeOptions`). The old names remain as `@deprecated`
    aliases, so this is non-breaking — migrate at your convenience.
  - `@nozzleio/mosaic-tanstack-table-core`: `createFilterBridge` →
    `createTanStackTableFilterBridge`. No alias is kept, so framework-agnostic
    consumers importing it directly must update the name.

- [#192](https://github.com/nozzle/mosaic-adapters/pull/192) [`f3b1718`](https://github.com/nozzle/mosaic-adapters/commit/f3b1718fe4eeae336e86a90decbbc6b3afe2f7a6) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Reorient the TanStack Table glue to v9-first ([#166](https://github.com/nozzle/mosaic-adapters/issues/166)). Public API unchanged — the
  only TanStack types crossing it (`SortingState`, `PaginationState`,
  `ColumnFiltersState`) are identical in v9, so no source changes were required.
  TanStack Table moves from a regular dependency to a peerDependency matching what
  consumers actually install: `@nozzleio/mosaic-tanstack-react-table` now peers on
  `@tanstack/react-table` (`^9.0.0-beta.34`) and `@nozzleio/mosaic-tanstack-table-core`
  peers on `@tanstack/table-core` (`^9.0.0-beta.34`, provided transitively by any
  TanStack Table framework adapter).

  Verified against `@tanstack/table-core@9.0.0-beta.34`.

## 0.8.0

### Minor Changes

- [#185](https://github.com/nozzle/mosaic-adapters/pull/185) [`a477934`](https://github.com/nozzle/mosaic-adapters/commit/a4779349415e9ec6f6869cbcd8d4e31ed4fa65a3) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add `clampPagination(pagination, totalRows)` — clamps a stale `pageIndex` into range when a filter shrinks the result set below the current page (the sharp edge of the manual-pagination model, where an unclamped index otherwise renders an empty table with a broken pager). `totalRows` of `0`/`undefined` clamps to page 0; the input is returned unchanged when already in range. Under `rowCount: 'window'`, past-the-end recovers only to page 0 (`totalRows: 0` is ambiguous there); use `rowCount: 'query'` for exact last-page recovery.

- [#167](https://github.com/nozzle/mosaic-adapters/pull/167) [`4771d10`](https://github.com/nozzle/mosaic-adapters/commit/4771d10e5053ba0d631f452efb005fc3eca1b9f7) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — rebuilt as pure TanStack glue.** The monolithic `MosaicDataTable` adapter is removed; TanStack Table is now driven in fully manual mode by the consumer, and this package only supplies the translation layer between TanStack state and Mosaic clients/selections.

  - State translators: `sortingToOrderBy` and `paginationToWindow`.
  - `createFilterBridge` — publishes one clause per actively filtered column onto a Selection, with six declarative clause kinds (`equals`, `ilike`, `prefix`, `range`, `date-range`, `in`), struct-path columns (dotted ids → struct access), stable per-column clause sources, and an `onExternalClear` callback for reconciling external clause removals (chip-bar X, `selection.reset()`) back into TanStack `columnFilters`.

  See `docs/tanstack/integration.md`.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`7be04e4`](https://github.com/nozzle/mosaic-adapters/commit/7be04e475f942761e17d2bc83d62af91d4e65cf7) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — bridge re-cut over FilterSet.** The column-filter bridge is now a thin `columnFilters` → `FilterSpec` translator; the target `FilterSet` owns all clause machinery (publishing, per-spec sources, targets, external-clear detection).

  - `FilterBridgeOptions.selection` is replaced by `set: FilterSet`.
  - New `idPrefix` option (spec id = `` `${idPrefix}${columnId}` ``) and per-column `label`/`target` on `FilterBridgeColumn`.
  - `onExternalClear` is replaced by `onExternalChange`, which now reports the full rebuilt `ColumnFiltersState` for both external spec removals and pre-mount hydrated specs, so consumers can adopt persisted state.
  - Internal clause construction, `BridgeClauseSource` bookkeeping, and the Selection value-listener plumbing are deleted — the six clause kinds and their TanStack-value normalization are unchanged.

  See `docs/tanstack/integration.md`.

### Patch Changes

- [#177](https://github.com/nozzle/mosaic-adapters/pull/177) [`981a59f`](https://github.com/nozzle/mosaic-adapters/commit/981a59f6745282e2cc1c49df169316fc84222a58) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - build(deps): upgrade dependencies to their latest eligible versions.

  Notably `@tanstack/store` and `@tanstack/react-store` move to `^0.11.0` (from `^0.9.1`) — no API changes. All other bumps are build tooling and dev dependencies (no change to published runtime surface). TypeScript moves to the `6.0.x` line.

- Updated dependencies [[`981a59f`](https://github.com/nozzle/mosaic-adapters/commit/981a59f6745282e2cc1c49df169316fc84222a58), [`4771d10`](https://github.com/nozzle/mosaic-adapters/commit/4771d10e5053ba0d631f452efb005fc3eca1b9f7), [`db5138b`](https://github.com/nozzle/mosaic-adapters/commit/db5138b57bad77ca9866c7052af6f4b2caebb761), [`45c8273`](https://github.com/nozzle/mosaic-adapters/commit/45c82730099083274ecfefa4bf2d8271447e5cbd), [`7be04e4`](https://github.com/nozzle/mosaic-adapters/commit/7be04e475f942761e17d2bc83d62af91d4e65cf7), [`2f5702c`](https://github.com/nozzle/mosaic-adapters/commit/2f5702c1f19dca55f7f4fa3dec82e7535b194ae4)]:
  - @nozzleio/mosaic-core@0.2.0

## 0.7.0

### Minor Changes

- [#150](https://github.com/nozzle/mosaic-adapters/pull/150) [`889066f`](https://github.com/nozzle/mosaic-adapters/commit/889066f74377b7e6aa4b9d244568b3fdec07ca2a) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat: subquery membership filters (`column [NOT] IN (SELECT ...)`)
  - `buildSubqueryPredicate` / `normalizeSubqueryFilterQuery` build IN-subquery
    predicates from mosaic-sql queries; `createSubqueryClause` publishes them as
    Selection clauses that never carry optimizer `meta`
  - filter-builder definitions accept a `subquery` factory: the predicate is
    rebuilt from the serializable binding state, so bindings, facets, and
    persistence work unchanged; runtimes accept a `context` Selection so
    factories can embed sibling-filter predicates, with automatic, convergent
    rebuilds on context changes (`reapplyCommittedFilterSelection`)
  - `MosaicFilter` / `useMosaicTableFilter` gain a `SUBQUERY` mode with a
    type-required `subquery` factory option

### Patch Changes

- [#150](https://github.com/nozzle/mosaic-adapters/pull/150) [`01d660d`](https://github.com/nozzle/mosaic-adapters/commit/01d660d57273fda2c9c893bc4691c592c7e86066) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix: prevent runaway rebuilds of subquery filters on sibling context changes

  `reapplyCommittedFilterSelection` republishes a subquery filter's clause when
  sibling context changes. Publishing relays synchronously back through the
  scope context (Mosaic relays a clause update to derived selections before
  committing its own value), re-entering the same listener while
  `filter.selection.clauses` still reports the pre-update predicate. The
  convergence guard therefore never matched and republished without bound,
  overflowing the stack and unmounting the consuming table. Reentrant reapplies
  for a selection are now suppressed while its publish settles.

- [#150](https://github.com/nozzle/mosaic-adapters/pull/150) [`2c00d03`](https://github.com/nozzle/mosaic-adapters/commit/2c00d036c0df450b1a558c14ce9c438c8131c4e0) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix: upgrade mosaic packages to `^0.27.0`

- [#150](https://github.com/nozzle/mosaic-adapters/pull/150) [`36162a6`](https://github.com/nozzle/mosaic-adapters/commit/36162a625f8db8440dbf43550d8f13d28cfeb068) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat: record executed main-query SQL on the client store (`_lastQuery`)

  Internal/experimental debug affordance: `MosaicDataTableStore._lastQuery`
  holds the stringified SQL of the most recent main table query, set right
  before submission to the coordinator. Marked `@internal`/`@experimental` —
  not part of the supported API and may change or be removed in any release.

- [#150](https://github.com/nozzle/mosaic-adapters/pull/150) [`744a74c`](https://github.com/nozzle/mosaic-adapters/commit/744a74cb5387509cd08e40d63557637cae554459) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - refactor(table-core,react-table): carve out clause construction and filter dispatch for subquery support

  Stage 1 of subquery-filter support; no behavior changes.
  - add clause-factory module (createValueClause/createClearClause) as the
    single construction point for Selection clauses, centralizing the
    clause meta policy ahead of meta-free subquery clauses
  - route all selection.update sites in table-core through the factory
  - export ResolvedFilter/StoredFilterValue(Mode)/FilterBuilderDataType
    from filter-builder types; make predicate dispatch and filter-client
    mode switches exhaustive (never guards)
  - make stored-filter-value reads mode-aware: unknown future modes (e.g.
    SUBQUERY) hydrate as empty state instead of being coerced into
    condition values
  - react-table: reuse createClearClause in filter-scope-hook; re-export
    the new filter-builder types

- [#147](https://github.com/nozzle/mosaic-adapters/pull/147) [`59caedb`](https://github.com/nozzle/mosaic-adapters/commit/59caedba242a58e6e7017da3e30363006285e503) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - refactor(table-core): expose table query factory as function in its own type

## 0.6.0

### Minor Changes

- [#145](https://github.com/nozzle/mosaic-adapters/pull/145) [`b648e9a`](https://github.com/nozzle/mosaic-adapters/commit/b648e9aeaef577a11d3a0707fc42f2f8a28a30e2) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - add HAVING routing for aggregate filters

  Adds HAVING routing for aggregate filters while preserving WHERE routing for row-level filters.

  Filter routing now supports both `where` and `having`, `havingBy` selections are applied to HAVING, and function-form table sources receive both routed predicates. Grouped tables can combine row filters in WHERE with aggregate filters in HAVING, and React filter-builder bindings can now apply and clear filters against a HAVING target.

  This also adds an Aggregate Filter Lab example, extends the filter-builder example with an aggregate HAVING scope, and updates docs and tests for WHERE/HAVING behavior.

  Includes follow-up fixes to keep grouped leaf row filters in WHERE even when grouped filter routing targets HAVING, and to reset pagination/requery correctly when aggregate filter selections change.

- [#145](https://github.com/nozzle/mosaic-adapters/pull/145) [`a2577ce`](https://github.com/nozzle/mosaic-adapters/commit/a2577ce346edaeb6420300116d802bc5d2c7d658) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - add explicit SQL filter clause routing

  Add explicit SQL filter clause routing for adapter-emitted predicates.

  This introduces a WHERE-only `SqlFilterClauseTarget` surface and routes generated predicates through explicit clause placement instead of applying them directly at each call site. Existing SQL behavior is preserved: all routed predicates still land in `WHERE`.

  Breaking change: function-form table sources now receive a routed filter object instead of the filter predicate directly.

  ```diff
  - table: (filter) => {
  + table: ({ where }) => {
      const query = mSql.Query.from("athletes").select("*");

  -   if (filter) {
  -     query.where(filter);
  +   if (where) {
  +     query.where(where);
      }

      return query;
    }
  ```

  Also added public API.

  ```ts
  type SqlFilterClauseTarget = 'where';

  type MosaicColumnMeta = {
    filterClauseTarget?: SqlFilterClauseTarget;
  };

  type MosaicDataTableOptions = {
    globalFilterClauseTarget?: SqlFilterClauseTarget;
    havingBy?: Selection;
    groupBy?: {
      filterClauseTarget?: SqlFilterClauseTarget;
    };
  };
  ```

## 0.5.1

### Patch Changes

- [#132](https://github.com/nozzle/mosaic-adapters/pull/132) [`5439926`](https://github.com/nozzle/mosaic-adapters/commit/54399261350487a9d49a4e388a2eed7ae68f4b1d) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix: trigger fresh CI release

## 0.5.0

### Minor Changes

- [#126](https://github.com/nozzle/mosaic-adapters/pull/126) [`83b321e`](https://github.com/nozzle/mosaic-adapters/commit/83b321e9a6797592441b182d55a602b6f8f0b38d) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat(table-core,react-table,react-mosaic): require 0.24.3 peer APIs

### Patch Changes

- [#126](https://github.com/nozzle/mosaic-adapters/pull/126) [`9e9e945`](https://github.com/nozzle/mosaic-adapters/commit/9e9e945a59cb540dd308833d3cce0b280f316389) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix: upgrade mosaic to `0.24.3`

- [#126](https://github.com/nozzle/mosaic-adapters/pull/126) [`fbb6809`](https://github.com/nozzle/mosaic-adapters/commit/fbb68090966b1ed82b3c496bfeaeeef4a5b875a4) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - refactor(table-core): use Mosaic null-safe inclusion predicates

## 0.4.0

### Minor Changes

- [#124](https://github.com/nozzle/mosaic-adapters/pull/124) [`4b95caf`](https://github.com/nozzle/mosaic-adapters/commit/4b95caf10bde70d3149d7acb2c45788362e4e6fe) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat: add Mosaic inputs and advanced table support

## 0.3.2

### Patch Changes

- [#121](https://github.com/nozzle/mosaic-adapters/pull/121) [`248668d`](https://github.com/nozzle/mosaic-adapters/commit/248668de9d828119429957ada1890abe709c23f8) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix(table-core): replace stale row-selection clauses across remounted clients

  When a table was remounted as a new client, the previous client's
  row-selection clause could remain in the shared Mosaic Selection.
  Subsequent selection updates from the new client then intersected with
  the stale clause, producing incorrect filters and stale KPI state.

  Reset stale row-selection clauses before publishing the current
  client's clause so shared row selection remains single-owner across
  fullscreen or enlarged table transitions.

  Add regression coverage for remount, replacement, and clear flows.

## 0.3.1

### Patch Changes

- [#118](https://github.com/nozzle/mosaic-adapters/pull/118) [`89621c2`](https://github.com/nozzle/mosaic-adapters/commit/89621c2c4df75ba8e11b1b6092019378318599e5) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix(table-core): make filter binding controllers StrictMode-safe

- [#120](https://github.com/nozzle/mosaic-adapters/pull/120) [`fc70c91`](https://github.com/nozzle/mosaic-adapters/commit/fc70c91c0b0e6df48c33d1dfea659a094bd1ff1c) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix(table-core): preserve row selection across remounted table clients

  Restore TanStack rowSelection from the shared Mosaic Selection value instead
  of only the current client-scoped value.

  Before this change, row selection UI was hydrated from
  selection.valueFor(client). That worked while the same table instance stayed
  mounted, but failed when a table was unmounted and remounted as a different
  client, such as when moving a widget into or out of fullscreen. In that
  case, crossfiltering and predicates remained active, but the new table
  instance lost its visual row-selection state because it had no source-scoped
  selection value of its own.

  This change adds shared selection hydration in the selection manager and uses
  it when syncing rowSelection back into table state. That keeps visual row
  selection consistent across multiple mounted clients and across remounts while
  preserving the existing source-scoped update behavior for writes.

  Also adds regression coverage for:
  - hydrating row selection into a remounted client
  - keeping row selection visuals in sync across two clients sharing one selection

## 0.3.0

### Minor Changes

- [#115](https://github.com/nozzle/mosaic-adapters/pull/115) [`661955f`](https://github.com/nozzle/mosaic-adapters/commit/661955fa18efaebca447c49424c56f654ca022ca) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat(table-core,react-table): support removable active chips for row-selection arrays

### Patch Changes

- [#117](https://github.com/nozzle/mosaic-adapters/pull/117) [`7fa4fc0`](https://github.com/nozzle/mosaic-adapters/commit/7fa4fc08bcfd3fcc55a1ee001277e3dda29ab730) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - chore(table-core): make mosaic packages peer dependencies

- [#117](https://github.com/nozzle/mosaic-adapters/pull/117) [`11f58c4`](https://github.com/nozzle/mosaic-adapters/commit/11f58c44eda51e0824d2b94683cec6d21ac2e30c) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - chore(deps): upgrade @uwdata/mosaic packages to 0.24.2

- [#113](https://github.com/nozzle/mosaic-adapters/pull/113) [`0f0c841`](https://github.com/nozzle/mosaic-adapters/commit/0f0c841a420ae855ed06e1b2c7650a90f95edf19) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - refactor: add SparklineStrategy for time-series facet queries

## 0.2.0

### Minor Changes

- [#110](https://github.com/nozzle/mosaic-adapters/pull/110) [`9d6eb8f`](https://github.com/nozzle/mosaic-adapters/commit/9d6eb8f66ec620660bd45b97f39e33b1ab86db50) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat: add public filter condition registries

## 0.1.1

### Patch Changes

- [#107](https://github.com/nozzle/mosaic-adapters/pull/107) [`87ab23c`](https://github.com/nozzle/mosaic-adapters/commit/87ab23c4f68caf15445fc2d8a3d78de888c14dbc) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Refresh the published packages against the latest compatible `@uwdata` Mosaic releases. This updates the workspace to `@uwdata/mosaic-core` `0.23.1` and `@uwdata/mosaic-sql` `0.23.0` for the adapter packages.

## 0.1.0

### Minor Changes

- [#103](https://github.com/nozzle/mosaic-adapters/pull/103) [`82ca7ff`](https://github.com/nozzle/mosaic-adapters/commit/82ca7ff9c0c558ee7e0b80b5b59eff6f8f5238ef) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add schema-driven filter-builder primitives for page and widget filter scopes.

  `@nozzleio/mosaic-tanstack-react-table`
  - add `FilterDefinition`-based filter-builder types
  - add `useMosaicFilters` for creating page and widget filter scopes
  - add `useFilterBinding` for operator/value binding
  - add `useFilterFacet` for facet-backed filter options
  - add docs and a trimmed example showing dynamic filter scope composition

  `@nozzleio/react-mosaic`
  - add `useComposedSelection` for explicit selection composition in React

  `@nozzleio/mosaic-tanstack-table-core`
  - add reusable condition predicate construction for filter-builder-backed condition filters

## 0.0.3

### Patch Changes

- [#101](https://github.com/nozzle/mosaic-adapters/pull/101) [`0ca8136`](https://github.com/nozzle/mosaic-adapters/commit/0ca8136ac285d3fb845d7edc7f211945debf3891) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Trigger a patch release across the published packages.

## 0.0.2

### Patch Changes

- [#94](https://github.com/nozzle/mosaic-adapters/pull/94) [`46d0702`](https://github.com/nozzle/mosaic-adapters/commit/46d07023be41c7a297b5af72a2080fd3defe7d84) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Publish the first automated patch release through the Changesets and trusted publishing workflow.

This file is maintained by Changesets.
