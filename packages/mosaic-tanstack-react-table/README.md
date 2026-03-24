# `@nozzleio/mosaic-tanstack-react-table`

React bindings for the Mosaic TanStack table adapter.

Install this package alongside `@nozzleio/react-mosaic`; the table hooks consume the shared React Mosaic context exposed there.

This package exports the React-facing table hooks and active-filter helpers:

- `useMosaicReactTable`
- `useGroupedTableState`
- `useMosaicTableFacetMenu`
- `useMosaicTableFilter`
- `useMosaicHistogram`
- `MosaicFilterProvider`
- `useFilterRegistry`
- `useActiveFilters`
- `useRegisterFilterSource`

Non-React utilities are available from adapter-owned subpaths:

- `@nozzleio/mosaic-tanstack-react-table/helpers`
- `@nozzleio/mosaic-tanstack-react-table/controllers`
- `@nozzleio/mosaic-tanstack-react-table/debug`

See the workspace docs under `docs/react/` for usage guides.
