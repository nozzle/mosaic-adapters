# @nozzleio/mosaic-tanstack-react-table

## 0.10.0

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

### Patch Changes

- Updated dependencies [[`0c42068`](https://github.com/nozzle/mosaic-adapters/commit/0c42068fcb75fa7625bd73528846ca91d8aa2361), [`f3b1718`](https://github.com/nozzle/mosaic-adapters/commit/f3b1718fe4eeae336e86a90decbbc6b3afe2f7a6)]:
  - @nozzleio/mosaic-tanstack-table-core@0.9.0

## 0.9.0

### Minor Changes

- [#167](https://github.com/nozzle/mosaic-adapters/pull/167) [`4771d10`](https://github.com/nozzle/mosaic-adapters/commit/4771d10e5053ba0d631f452efb005fc3eca1b9f7) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — rebuilt.** `useMosaicReactTable` and the legacy hook surface are removed. This package is now a thin React wrapper over `@nozzleio/mosaic-tanstack-table-core`, which is a regular dependency whose full public API is re-exported here, so consumers install and import from this package alone.

  - `useTanStackFilterBridge` — React binding around the glue core's `createFilterBridge`.
  - Full re-export of the glue core (`sortingToOrderBy`, `paginationToWindow`, `createFilterBridge`, and the bridge types).

  See `docs/tanstack/integration.md`.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`7be04e4`](https://github.com/nozzle/mosaic-adapters/commit/7be04e475f942761e17d2bc83d62af91d4e65cf7) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — follows the glue-core bridge re-cut.** `useTanStackFilterBridge` carries the same option changes as `@nozzleio/mosaic-tanstack-table-core`.

  - `selection` → `set: FilterSet`; new `idPrefix` and per-column `label`/`target`.
  - `onExternalClear` → `onExternalChange`, reporting rebuilt `ColumnFiltersState` for external removals and hydration adoption.
  - `@nozzleio/mosaic-core` moves from a dev dependency to a runtime `dependency`.

  See `docs/tanstack/integration.md`.

### Patch Changes

- [#177](https://github.com/nozzle/mosaic-adapters/pull/177) [`981a59f`](https://github.com/nozzle/mosaic-adapters/commit/981a59f6745282e2cc1c49df169316fc84222a58) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - build(deps): upgrade dependencies to their latest eligible versions.

  Notably `@tanstack/store` and `@tanstack/react-store` move to `^0.11.0` (from `^0.9.1`) — no API changes. All other bumps are build tooling and dev dependencies (no change to published runtime surface). TypeScript moves to the `6.0.x` line.

- Updated dependencies [[`981a59f`](https://github.com/nozzle/mosaic-adapters/commit/981a59f6745282e2cc1c49df169316fc84222a58), [`4771d10`](https://github.com/nozzle/mosaic-adapters/commit/4771d10e5053ba0d631f452efb005fc3eca1b9f7), [`db5138b`](https://github.com/nozzle/mosaic-adapters/commit/db5138b57bad77ca9866c7052af6f4b2caebb761), [`45c8273`](https://github.com/nozzle/mosaic-adapters/commit/45c82730099083274ecfefa4bf2d8271447e5cbd), [`7be04e4`](https://github.com/nozzle/mosaic-adapters/commit/7be04e475f942761e17d2bc83d62af91d4e65cf7), [`2f5702c`](https://github.com/nozzle/mosaic-adapters/commit/2f5702c1f19dca55f7f4fa3dec82e7535b194ae4), [`a477934`](https://github.com/nozzle/mosaic-adapters/commit/a4779349415e9ec6f6869cbcd8d4e31ed4fa65a3), [`4771d10`](https://github.com/nozzle/mosaic-adapters/commit/4771d10e5053ba0d631f452efb005fc3eca1b9f7), [`7be04e4`](https://github.com/nozzle/mosaic-adapters/commit/7be04e475f942761e17d2bc83d62af91d4e65cf7)]:
  - @nozzleio/mosaic-core@0.2.0
  - @nozzleio/mosaic-tanstack-table-core@0.8.0

## 0.8.0

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

- [#150](https://github.com/nozzle/mosaic-adapters/pull/150) [`2c00d03`](https://github.com/nozzle/mosaic-adapters/commit/2c00d036c0df450b1a558c14ce9c438c8131c4e0) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix: upgrade mosaic packages to `^0.27.0`

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

- Updated dependencies [[`01d660d`](https://github.com/nozzle/mosaic-adapters/commit/01d660d57273fda2c9c893bc4691c592c7e86066), [`2c00d03`](https://github.com/nozzle/mosaic-adapters/commit/2c00d036c0df450b1a558c14ce9c438c8131c4e0), [`36162a6`](https://github.com/nozzle/mosaic-adapters/commit/36162a625f8db8440dbf43550d8f13d28cfeb068), [`744a74c`](https://github.com/nozzle/mosaic-adapters/commit/744a74cb5387509cd08e40d63557637cae554459), [`59caedb`](https://github.com/nozzle/mosaic-adapters/commit/59caedba242a58e6e7017da3e30363006285e503), [`889066f`](https://github.com/nozzle/mosaic-adapters/commit/889066f74377b7e6aa4b9d244568b3fdec07ca2a)]:
  - @nozzleio/mosaic-tanstack-table-core@0.7.0

## 0.7.0

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

### Patch Changes

- Updated dependencies [[`b648e9a`](https://github.com/nozzle/mosaic-adapters/commit/b648e9aeaef577a11d3a0707fc42f2f8a28a30e2), [`a2577ce`](https://github.com/nozzle/mosaic-adapters/commit/a2577ce346edaeb6420300116d802bc5d2c7d658)]:
  - @nozzleio/mosaic-tanstack-table-core@0.6.0

## 0.6.1

### Patch Changes

- [#132](https://github.com/nozzle/mosaic-adapters/pull/132) [`5439926`](https://github.com/nozzle/mosaic-adapters/commit/54399261350487a9d49a4e388a2eed7ae68f4b1d) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix: trigger fresh CI release

- Updated dependencies [[`5439926`](https://github.com/nozzle/mosaic-adapters/commit/54399261350487a9d49a4e388a2eed7ae68f4b1d)]:
  - @nozzleio/mosaic-tanstack-table-core@0.5.1

## 0.6.0

### Minor Changes

- [#126](https://github.com/nozzle/mosaic-adapters/pull/126) [`83b321e`](https://github.com/nozzle/mosaic-adapters/commit/83b321e9a6797592441b182d55a602b6f8f0b38d) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat(table-core,react-table,react-mosaic): require 0.24.3 peer APIs

### Patch Changes

- [#126](https://github.com/nozzle/mosaic-adapters/pull/126) [`9e9e945`](https://github.com/nozzle/mosaic-adapters/commit/9e9e945a59cb540dd308833d3cce0b280f316389) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix: upgrade mosaic to `0.24.3`

- Updated dependencies [[`9e9e945`](https://github.com/nozzle/mosaic-adapters/commit/9e9e945a59cb540dd308833d3cce0b280f316389), [`83b321e`](https://github.com/nozzle/mosaic-adapters/commit/83b321e9a6797592441b182d55a602b6f8f0b38d), [`fbb6809`](https://github.com/nozzle/mosaic-adapters/commit/fbb68090966b1ed82b3c496bfeaeeef4a5b875a4)]:
  - @nozzleio/mosaic-tanstack-table-core@0.5.0

## 0.5.0

### Minor Changes

- [#124](https://github.com/nozzle/mosaic-adapters/pull/124) [`4b95caf`](https://github.com/nozzle/mosaic-adapters/commit/4b95caf10bde70d3149d7acb2c45788362e4e6fe) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat: add Mosaic inputs and advanced table support

### Patch Changes

- Updated dependencies [[`4b95caf`](https://github.com/nozzle/mosaic-adapters/commit/4b95caf10bde70d3149d7acb2c45788362e4e6fe)]:
  - @nozzleio/mosaic-tanstack-table-core@0.4.0

## 0.4.1

### Patch Changes

- Updated dependencies [[`248668d`](https://github.com/nozzle/mosaic-adapters/commit/248668de9d828119429957ada1890abe709c23f8)]:
  - @nozzleio/mosaic-tanstack-table-core@0.3.2

## 0.4.0

### Minor Changes

- [#118](https://github.com/nozzle/mosaic-adapters/pull/118) [`f96c275`](https://github.com/nozzle/mosaic-adapters/commit/f96c275726015f36c215c2d80bbecb23941a7775) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat(react-table): add per-filter persistence helpers and binding hydration support

### Patch Changes

- Updated dependencies [[`89621c2`](https://github.com/nozzle/mosaic-adapters/commit/89621c2c4df75ba8e11b1b6092019378318599e5), [`fc70c91`](https://github.com/nozzle/mosaic-adapters/commit/fc70c91c0b0e6df48c33d1dfea659a094bd1ff1c)]:
  - @nozzleio/mosaic-tanstack-table-core@0.3.1

## 0.3.0

### Minor Changes

- [#115](https://github.com/nozzle/mosaic-adapters/pull/115) [`661955f`](https://github.com/nozzle/mosaic-adapters/commit/661955fa18efaebca447c49424c56f654ca022ca) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat(table-core,react-table): support removable active chips for row-selection arrays

### Patch Changes

- [#117](https://github.com/nozzle/mosaic-adapters/pull/117) [`95911d9`](https://github.com/nozzle/mosaic-adapters/commit/95911d93697470c32e1c84f0eb0bb2ff4b8744c6) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - chore(react-table): make mosaic packages peer dependencies

- [#113](https://github.com/nozzle/mosaic-adapters/pull/113) [`513995a`](https://github.com/nozzle/mosaic-adapters/commit/513995a6d134e88a67fe9cdd04cd43af1f876f87) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - refactor: add useMosaicSparkline hook for per-row sparkline data

- [#117](https://github.com/nozzle/mosaic-adapters/pull/117) [`11f58c4`](https://github.com/nozzle/mosaic-adapters/commit/11f58c44eda51e0824d2b94683cec6d21ac2e30c) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - chore(deps): upgrade @uwdata/mosaic packages to 0.24.2

- Updated dependencies [[`7fa4fc0`](https://github.com/nozzle/mosaic-adapters/commit/7fa4fc08bcfd3fcc55a1ee001277e3dda29ab730), [`661955f`](https://github.com/nozzle/mosaic-adapters/commit/661955fa18efaebca447c49424c56f654ca022ca), [`11f58c4`](https://github.com/nozzle/mosaic-adapters/commit/11f58c44eda51e0824d2b94683cec6d21ac2e30c), [`0f0c841`](https://github.com/nozzle/mosaic-adapters/commit/0f0c841a420ae855ed06e1b2c7650a90f95edf19)]:
  - @nozzleio/mosaic-tanstack-table-core@0.3.0

## 0.2.0

### Minor Changes

- [#110](https://github.com/nozzle/mosaic-adapters/pull/110) [`9d6eb8f`](https://github.com/nozzle/mosaic-adapters/commit/9d6eb8f66ec620660bd45b97f39e33b1ab86db50) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat: add public filter condition registries

### Patch Changes

- Updated dependencies [[`9d6eb8f`](https://github.com/nozzle/mosaic-adapters/commit/9d6eb8f66ec620660bd45b97f39e33b1ab86db50)]:
  - @nozzleio/mosaic-tanstack-table-core@0.2.0

## 0.1.1

### Patch Changes

- [#107](https://github.com/nozzle/mosaic-adapters/pull/107) [`87ab23c`](https://github.com/nozzle/mosaic-adapters/commit/87ab23c4f68caf15445fc2d8a3d78de888c14dbc) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Refresh the published packages against the latest compatible `@uwdata` Mosaic releases. This updates the workspace to `@uwdata/mosaic-core` `0.23.1` and `@uwdata/mosaic-sql` `0.23.0` for the adapter packages.

- Updated dependencies [[`87ab23c`](https://github.com/nozzle/mosaic-adapters/commit/87ab23c4f68caf15445fc2d8a3d78de888c14dbc)]:
  - @nozzleio/mosaic-tanstack-table-core@0.1.1

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

### Patch Changes

- Updated dependencies [[`82ca7ff`](https://github.com/nozzle/mosaic-adapters/commit/82ca7ff9c0c558ee7e0b80b5b59eff6f8f5238ef)]:
  - @nozzleio/mosaic-tanstack-table-core@0.1.0
  - @nozzleio/react-mosaic@0.1.0

## 0.0.3

### Patch Changes

- [#101](https://github.com/nozzle/mosaic-adapters/pull/101) [`0ca8136`](https://github.com/nozzle/mosaic-adapters/commit/0ca8136ac285d3fb845d7edc7f211945debf3891) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Trigger a patch release across the published packages.

- Updated dependencies [[`0ca8136`](https://github.com/nozzle/mosaic-adapters/commit/0ca8136ac285d3fb845d7edc7f211945debf3891)]:
  - @nozzleio/mosaic-tanstack-table-core@0.0.3
  - @nozzleio/react-mosaic@0.0.3

## 0.0.2

### Patch Changes

- [#94](https://github.com/nozzle/mosaic-adapters/pull/94) [`46d0702`](https://github.com/nozzle/mosaic-adapters/commit/46d07023be41c7a297b5af72a2080fd3defe7d84) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Publish the first automated patch release through the Changesets and trusted publishing workflow.

- Updated dependencies [[`46d0702`](https://github.com/nozzle/mosaic-adapters/commit/46d07023be41c7a297b5af72a2080fd3defe7d84)]:
  - @nozzleio/react-mosaic@0.0.2
  - @nozzleio/mosaic-tanstack-table-core@0.0.2

This file is maintained by Changesets.
