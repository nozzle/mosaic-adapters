# @nozzleio/mosaic-tanstack-react-table

React bindings for the Mosaic TanStack Table glue:

- **`useTanStackTableFilterBridge({ filters, selection, columns })`** — publishes TanStack Table `columnFilters` state as clauses on a Mosaic Selection; clauses are replaced (never accumulated), removed when filters clear, and cleaned up on unmount.
- Re-exports the full [`@nozzleio/mosaic-tanstack-table-core`](https://github.com/nozzle/mosaic-adapters/tree/main/packages/mosaic-tanstack-table-core) public API (`sortingToOrderBy`, `paginationToWindow`, `createTanStackTableFilterBridge`, types) — install this package only.

Built against TanStack Table v9: `@tanstack/react-table` is a peer dependency you provide — install `@tanstack/react-table@beta` (v9 is not yet the npm `latest` tag).

Pairs with [`@nozzleio/react-mosaic`](https://github.com/nozzle/mosaic-adapters/tree/main/packages/react-mosaic) for the data clients themselves.

See the [TanStack Table integration docs](https://github.com/nozzle/mosaic-adapters/tree/main/docs/tanstack-table/integration.md).
