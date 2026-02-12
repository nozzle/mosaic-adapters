# Package Map

This page explains which package to use and where to learn each concept.

## Primary Library

Most users should start with `@nozzleio/mosaic-tanstack-react-table`. It provides the TanStack Table integration and most of the surface area you touch in a React app.

## Supporting Libraries

`@nozzleio/react-mosaic` provides React bindings for Mosaic primitives (coordinator context, selection helpers, registries).

`@nozzleio/mosaic-tanstack-table-core` is framework-agnostic logic used internally by the React package.

## Package Matrix

| Package                                 | Role                           | When you use it                                                |
| --------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| `@nozzleio/mosaic-tanstack-react-table` | TanStack Table adapter + hooks | Tables, filters, facets, histograms, row selection, pagination |
| `@nozzleio/react-mosaic`                | React bindings for Mosaic      | Coordinator context, selection helpers, registries             |
| `@nozzleio/mosaic-tanstack-table-core`  | Core engine                    | Extending or using the adapter outside React                   |

## Key Exports (By Package)

`@nozzleio/mosaic-tanstack-react-table`

- `useMosaicReactTable`
- `useMosaicTableFilter`
- `useMosaicTableFacetMenu`
- `useMosaicHistogram`
- `createMosaicMapping`
- `createMosaicColumnHelper`
- `HistogramController`

`@nozzleio/react-mosaic`

- `MosaicContext`, `useCoordinator`
- `MosaicConnectorProvider`, `useConnectorStatus`, `useMosaicCoordinator`
- `HttpArrowConnector`
- `useMosaicSelection` / `useMosaicSelections`
- `useCascadingContexts`
- `useRequireMode`
- `SelectionRegistryProvider`, `useRegisterSelections`
- `MosaicFilterProvider`, `useRegisterFilterSource`, `useActiveFilters`

## Where to Start

- React integration: `docs/react/simple-usage.md`
- Dual-mode (WASM + remote): `docs/react/dual-mode-setup.md`
- Inputs and filters: `docs/react/inputs.md`
- Topologies and multi-table: `docs/react/complex-setup.md`
- Core flow: `docs/core/data-flow.md`
