# @nozzleio/react-mosaic

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
