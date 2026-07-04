# @nozzleio/mosaic-tanstack-table-core

Framework-agnostic TanStack Table glue for the Mosaic data clients — the only TanStack-aware layer in the stack:

- **Pure translators**: `sortingToOrderBy(sorting, columnMap?)`, `paginationToWindow(pagination)`, and `clampPagination(pagination, totalRows)` turn TanStack state slices into serializable rows-client inputs.
- **Filter-bridge core**: `createFilterBridge({ selection, columns })` publishes TanStack `columnFilters` state as clauses on a Mosaic Selection, with stable per-column clause identity, value-diffed publishes, and removal on clear/destroy.

React users should install [`@nozzleio/mosaic-tanstack-react-table`](https://github.com/nozzle/mosaic-adapters/tree/main/packages/mosaic-tanstack-react-table) instead, which re-exports this package's full public API.

See the [TanStack integration docs](https://github.com/nozzle/mosaic-adapters/tree/main/docs/tanstack/integration.md).
