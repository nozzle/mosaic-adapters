# @nozzleio/mosaic-tanstack-react-table

React bindings for the Mosaic TanStack Table glue:

- **`useTanStackFilterBridge({ filters, selection, columns })`** — publishes TanStack `columnFilters` state as clauses on a Mosaic Selection; clauses are replaced (never accumulated), removed when filters clear, and cleaned up on unmount.
- Re-exports the full [`@nozzleio/mosaic-tanstack-table-core`](https://github.com/nozzle/mosaic-adapters/tree/main/packages/mosaic-tanstack-table-core) public API (`sortingToOrderBy`, `paginationToWindow`, `createFilterBridge`, types) — install this package only.

Pairs with [`@nozzleio/react-mosaic`](https://github.com/nozzle/mosaic-adapters/tree/main/packages/react-mosaic) for the data clients themselves.

See the [TanStack integration docs](https://github.com/nozzle/mosaic-adapters/tree/main/docs/tanstack/integration.md).
