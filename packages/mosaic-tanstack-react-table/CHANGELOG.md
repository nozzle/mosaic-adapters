# @nozzleio/mosaic-tanstack-react-table

## 1.0.0

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
