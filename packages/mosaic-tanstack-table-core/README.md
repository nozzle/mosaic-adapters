# @nozzleio/mosaic-tanstack-table-core

Framework-agnostic TanStack Table glue for the Mosaic data clients — the only TanStack Table-aware layer in the stack:

- **Pure translators**: `sortingToOrderBy(sorting, columnMap?)`, `paginationToWindow(pagination)`, and `clampPagination(pagination, totalRows)` turn TanStack Table state slices into serializable rows-client inputs.
- **Filter-bridge core**: `createTanStackTableFilterBridge({ selection, columns })` publishes TanStack Table `columnFilters` state as clauses on a Mosaic Selection, with stable per-column clause identity, value-diffed publishes, and removal on clear/destroy.

Built against TanStack Table v9: `@tanstack/table-core` is a peer dependency you provide — normally by installing `@tanstack/react-table@beta`.

React users should install [`@nozzleio/mosaic-tanstack-react-table`](https://github.com/nozzle/mosaic-adapters/tree/main/packages/mosaic-tanstack-react-table) instead, which re-exports this package's full public API.

See the [TanStack Table integration docs](https://github.com/nozzle/mosaic-adapters/tree/main/docs/tanstack-table/integration.md).
