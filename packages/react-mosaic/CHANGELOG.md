# @nozzleio/react-mosaic

## 0.6.0

### Minor Changes

- [#207](https://github.com/nozzle/mosaic-adapters/pull/207) [`a07e42e`](https://github.com/nozzle/mosaic-adapters/commit/a07e42e40b8b55f79f6106c219bda96d9fe0b553) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - The data hooks (`useMosaicRows`, `useMosaicFacet`, `useMosaicHistogram`, `useMosaicSparkline`, `useMosaicRollup`, `useMosaicPivot`, `useMosaicValues`) now pass through the new `skipSources` option and fold it into their structural identity via `skipSourcesKey`, so changing the excluded-source set rebinds the client while an equal set does not trigger a rebind. `skipSourcesKey` is exported from `use-data-client` alongside `paramsKey`.

### Patch Changes

- Updated dependencies [[`72d551d`](https://github.com/nozzle/mosaic-adapters/commit/72d551dce5b0c47f5f7625595521918a69c70581)]:
  - @nozzleio/mosaic-core@0.4.0

## 0.5.1

### Patch Changes

- Updated dependencies [[`870c794`](https://github.com/nozzle/mosaic-adapters/commit/870c794ad58c1a62f8472dced2ee265c26c27525), [`74ef2a7`](https://github.com/nozzle/mosaic-adapters/commit/74ef2a73d3349430a224c30cee9d06586301542f), [`07aae12`](https://github.com/nozzle/mosaic-adapters/commit/07aae12f262b044e6d30ddc04f7e9ba7a7093f3c), [`b7d6a27`](https://github.com/nozzle/mosaic-adapters/commit/b7d6a273092525fb83d2a9fde5b1a96062c4d66c), [`c6cc739`](https://github.com/nozzle/mosaic-adapters/commit/c6cc7397c36f8e4e360d1ec5bdbe60f515b812c2)]:
  - @nozzleio/mosaic-core@0.3.1

## 0.5.0

### Minor Changes

- [#202](https://github.com/nozzle/mosaic-adapters/pull/202) [`bfd311c`](https://github.com/nozzle/mosaic-adapters/commit/bfd311ce04021cef18cf8d9cfc975933bd8384b4) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Histogram clients now accept `scale: 'linear' | 'log'`. Log-scaled histograms
  discover a positive extent and produce multiplicative bin boundaries, allowing
  custom renderers to align queried counts with a logarithmic visual axis.

- [#199](https://github.com/nozzle/mosaic-adapters/pull/199) [`c07ceee`](https://github.com/nozzle/mosaic-adapters/commit/c07ceee82c1081dc488a47cf6baa65feef267fd8) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - `useTopology` now takes an optional construction initializer on its options bag as `UseTopologyOptions.initialize`, alongside the existing `selections` / `filterSets` fields, letting applications synchronously seed a newly-created topology before querying children receive it. If initialization throws, the partially-built topology is destroyed before the error propagates.

  Recreation is now keyed on the identities of `config`, `options.selections`, and `options.filterSets` individually — no longer on the options bag object as a whole — so callers may build the bag inline each render (`useTopology(config, { ...options, initialize })`) without rebuilding the topology. `initialize`'s identity never keys recreation.

### Patch Changes

- Updated dependencies [[`bfd311c`](https://github.com/nozzle/mosaic-adapters/commit/bfd311ce04021cef18cf8d9cfc975933bd8384b4)]:
  - @nozzleio/mosaic-core@0.3.0

## 0.4.1

### Patch Changes

- [#194](https://github.com/nozzle/mosaic-adapters/pull/194) [`e590fed`](https://github.com/nozzle/mosaic-adapters/commit/e590fedc9bca9d936fcb14d694ae7bae6ec12d63) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Use `useSelector` instead of the deprecated `useStore` from `@tanstack/react-store` for all store subscriptions. No change to hook behavior or public APIs.

- Updated dependencies [[`33367fb`](https://github.com/nozzle/mosaic-adapters/commit/33367fba7ed50e915612e67570d83d19bf386207)]:
  - @nozzleio/mosaic-core@0.2.1

## 0.4.0

### Minor Changes

- [#167](https://github.com/nozzle/mosaic-adapters/pull/167) [`4771d10`](https://github.com/nozzle/mosaic-adapters/commit/4771d10e5053ba0d631f452efb005fc3eca1b9f7) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — rebuilt from scratch.** `@nozzleio/react-mosaic` is now a set of controlled-binding React hooks over `@nozzleio/mosaic-core`; the legacy provider, registry, and hook APIs are removed. The core is a regular dependency whose full public API is re-exported here (the `@tanstack/react-table` distribution model), so consumers install and import from this package alone.

  - Provider and coordinator: `MosaicProvider`, `useMosaicCoordinator`.
  - Data hooks over the core clients: `useMosaicRows`, `useMosaicValues`, `useMosaicFacet`, `useMosaicHistogram`, `useMosaicSparkline`, `useMosaicRollup`, `useMosaicPivot`, `useMosaicSchema`, plus `useVgPlot`.
  - Filter-builder bindings: `useMosaicFilters`, `useFilterBinding`, `useFilterFacet`, and `useFilterChips`.
  - Topology and selection helpers: `useMosaicSelections`, `useCascadingContexts`, `useComposedSelection`, `useMosaicSelectionValue`.

  See `docs/react/*`.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`45c8273`](https://github.com/nozzle/mosaic-adapters/commit/45c82730099083274ecfefa4bf2d8271447e5cbd) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Adds `useFilterSetState` and `useFilterSetChips`, subscription hooks over a `FilterSet`'s `@tanstack/store` (whole state, and just the derived chip list). Additive — no breaking changes.

  - The facet, histogram, and rows client hooks' structural keys now understand the `publish.into` form: a change of target `FilterSet`, spec `id`, `kind`, or `label` recreates the client, matching the existing `publish.as` identity rules.

  See `docs/core/filter-set.md` and `docs/react/hooks.md`.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`7be04e4`](https://github.com/nozzle/mosaic-adapters/commit/7be04e475f942761e17d2bc83d62af91d4e65cf7) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **BREAKING — filter-builder hooks deleted.** The per-binding hook surface is subsumed by the `FilterSet` hooks.

  - Removed: `useFilterBinding`, `useMosaicFilters`, `useFilterFacet`, `useFilterBindingControllerState`, `useFilterChips`, and the `FilterBindingPersister` types.
  - Migrate to `useFilterSetState` / `useFilterSetChips` over a `createFilterSet`, and `publish.into` on the facet, histogram, and rows client hooks for widget-to-set wiring.

  See `docs/core/filter-set.md`.

- [#176](https://github.com/nozzle/mosaic-adapters/pull/176) [`2f5702c`](https://github.com/nozzle/mosaic-adapters/commit/2f5702c1f19dca55f7f4fa3dec82e7535b194ae4) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - **Contains breaking changes (0.x convention).** `persist` passes through `useMosaicFacet`, `useMosaicHistogram`, and `useMosaicRows` as a structural option — a new persister identity is a new storage location, so keep it stable (module scope or `useMemo`) or the client recreates every render.

  - Breaking: scope-level filter persistence is removed — `FilterScopePersister`, `FilterScopePersistenceContext`, `FilterScopePersistenceWriteContext`, `createFilterScopePersistenceContext`, `createSparseFilterScopeSnapshot`, and the `persister` option on `useMosaicFilters` are gone. Per-binding persisters (`useFilterBinding({ persister })`) cover the use case.
  - Breaking: `FilterBindingPersister` is re-typed as `Persister<FilterBindingState, FilterBindingPersistenceContext>` (the new core contract). The write reason `'apply'` is renamed to `'update'`; `FilterPersistenceWriteReason` is now an alias of the core's `PersisterWriteReason`.

  See `docs/core/filter-builder.md` and `docs/react/hooks.md`.

- [#185](https://github.com/nozzle/mosaic-adapters/pull/185) [`e46da90`](https://github.com/nozzle/mosaic-adapters/commit/e46da901a1386566ffc9bbd92a765b7b667086c5) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - Add `useMosaicSelection(type = 'intersect')` — a singular companion to `useMosaicSelections` returning one stable `Selection`. It's the first hook most consumers reach for, both for `filterBy` / `havingBy` wiring and as a lightweight pub/sub channel between sibling widgets. The `useState(() => Selection.single())` idiom is documented as the escape hatch.

### Patch Changes

- [#177](https://github.com/nozzle/mosaic-adapters/pull/177) [`981a59f`](https://github.com/nozzle/mosaic-adapters/commit/981a59f6745282e2cc1c49df169316fc84222a58) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - build(deps): upgrade dependencies to their latest eligible versions.

  Notably `@tanstack/store` and `@tanstack/react-store` move to `^0.11.0` (from `^0.9.1`) — no API changes. All other bumps are build tooling and dev dependencies (no change to published runtime surface). TypeScript moves to the `6.0.x` line.

- Updated dependencies [[`981a59f`](https://github.com/nozzle/mosaic-adapters/commit/981a59f6745282e2cc1c49df169316fc84222a58), [`4771d10`](https://github.com/nozzle/mosaic-adapters/commit/4771d10e5053ba0d631f452efb005fc3eca1b9f7), [`db5138b`](https://github.com/nozzle/mosaic-adapters/commit/db5138b57bad77ca9866c7052af6f4b2caebb761), [`45c8273`](https://github.com/nozzle/mosaic-adapters/commit/45c82730099083274ecfefa4bf2d8271447e5cbd), [`7be04e4`](https://github.com/nozzle/mosaic-adapters/commit/7be04e475f942761e17d2bc83d62af91d4e65cf7), [`2f5702c`](https://github.com/nozzle/mosaic-adapters/commit/2f5702c1f19dca55f7f4fa3dec82e7535b194ae4)]:
  - @nozzleio/mosaic-core@0.2.0

## 0.3.2

### Patch Changes

- [#150](https://github.com/nozzle/mosaic-adapters/pull/150) [`2c00d03`](https://github.com/nozzle/mosaic-adapters/commit/2c00d036c0df450b1a558c14ce9c438c8131c4e0) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix: upgrade mosaic packages to `^0.27.0`

## 0.3.1

### Patch Changes

- [#132](https://github.com/nozzle/mosaic-adapters/pull/132) [`5439926`](https://github.com/nozzle/mosaic-adapters/commit/54399261350487a9d49a4e388a2eed7ae68f4b1d) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix: trigger fresh CI release

## 0.3.0

### Minor Changes

- [#126](https://github.com/nozzle/mosaic-adapters/pull/126) [`83b321e`](https://github.com/nozzle/mosaic-adapters/commit/83b321e9a6797592441b182d55a602b6f8f0b38d) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat(table-core,react-table,react-mosaic): require 0.24.3 peer APIs

### Patch Changes

- [#126](https://github.com/nozzle/mosaic-adapters/pull/126) [`9e9e945`](https://github.com/nozzle/mosaic-adapters/commit/9e9e945a59cb540dd308833d3cce0b280f316389) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - fix: upgrade mosaic to `0.24.3`

## 0.2.0

### Minor Changes

- [#115](https://github.com/nozzle/mosaic-adapters/pull/115) [`53d8c34`](https://github.com/nozzle/mosaic-adapters/commit/53d8c3410d6224cfb9b6a5553cf12380f9353b18) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - feat(react-mosaic): add source-scoped selection value reads

### Patch Changes

- [#117](https://github.com/nozzle/mosaic-adapters/pull/117) [`d79ebb3`](https://github.com/nozzle/mosaic-adapters/commit/d79ebb3a62ec877e4fe40a92eebb948112a31e3e) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - chore(react-mosaic): make mosaic-core a peer dependency

- [#117](https://github.com/nozzle/mosaic-adapters/pull/117) [`11f58c4`](https://github.com/nozzle/mosaic-adapters/commit/11f58c44eda51e0824d2b94683cec6d21ac2e30c) Thanks [@SeanCassiere](https://github.com/SeanCassiere)! - chore(deps): upgrade @uwdata/mosaic packages to 0.24.2

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
