# @nozzleio/mosaic-tanstack-react-table

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
