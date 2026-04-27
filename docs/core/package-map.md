# Package Map

This page explains which package to use and where to learn each concept.

## Primary Library

Most React users should start with `@nozzleio/mosaic-tanstack-react-table` and `@nozzleio/react-mosaic`. The table package owns the TanStack-facing hooks and active-filter APIs; `react-mosaic` owns the shared coordinator and selection context those hooks rely on.

## Supporting Libraries

`@nozzleio/react-mosaic` provides React bindings for Mosaic primitives (coordinator context, selection helpers, selection registry, connector helpers).

`@nozzleio/mosaic-tanstack-table-core` is framework-agnostic logic used internally by the React package. Its root export is intentionally smaller than before; lower-level grouped, filter-registry, facet-strategy, and sidecar helpers live on explicit subpaths.

## Package Matrix

| Package                                 | Role                           | When you use it                                                |
| --------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| `@nozzleio/mosaic-tanstack-react-table` | TanStack Table adapter + hooks | Tables, filters, facets, histograms, row selection, pagination |
| `@nozzleio/react-mosaic`                | React bindings for Mosaic      | Coordinator context, selection helpers, selection registry     |
| `@nozzleio/mosaic-tanstack-table-core`  | Core engine                    | Headless extension points and non-React integrations           |

## Key Exports (By Package)

`@nozzleio/mosaic-tanstack-react-table`

- `useMosaicReactTable`
- `useMosaicTableFilter`
- `useMosaicTableFacetMenu`
- `useMosaicHistogram`
- `useGroupedTableState`
- `MosaicFilterProvider`, `useFilterRegistry`, `useActiveFilters`, `useRegisterFilterSource`
- `@nozzleio/mosaic-tanstack-react-table/inputs`: headless input hooks, including `useMosaicTextInput` and `useMosaicSelectInput`
- `@nozzleio/mosaic-tanstack-react-table/helpers`: mapping helpers and coercion utilities
- `@nozzleio/mosaic-tanstack-react-table/controllers`: headless controllers such as `AggregationBridge` and `HistogramController`
- `@nozzleio/mosaic-tanstack-react-table/debug`: `logger`

`@nozzleio/react-mosaic`

- `MosaicContext`, `useCoordinator`
- `MosaicConnectorProvider`, `useConnectorStatus`, `useMosaicCoordinator`
- `HttpArrowConnector`
- `useMosaicSelection` / `useMosaicSelections`
- `useCascadingContexts`
- `useRequireMode`
- `SelectionRegistryProvider`, `useRegisterSelections`

`@nozzleio/mosaic-tanstack-table-core`

- Root: `MosaicDataTable`, `createMosaicDataTableClient`, `MosaicFacetMenu`, `MosaicFilter`, `createMosaicMapping`, `createMosaicColumnHelper`
- `@nozzleio/mosaic-tanstack-table-core/grouped`: grouped query helpers and grouped row types
- `@nozzleio/mosaic-tanstack-table-core/filter-registry`: headless active-filter registry types and implementation
- `@nozzleio/mosaic-tanstack-table-core/facet-strategies`: low-level facet strategies such as `HistogramStrategy`
- `@nozzleio/mosaic-tanstack-table-core/input-core`: framework-agnostic `TextInputCore`, `SelectInputCore`, input state types, and select option normalization types for non-React adapters
- `@nozzleio/mosaic-tanstack-table-core/sidecar`: typed sidecar client helpers

For React apps, use the active-filter APIs from `@nozzleio/mosaic-tanstack-react-table` rather than importing the headless filter registry directly.

## Where to Start

- React integration: `docs/react/simple-usage.md`
- Dual-mode (WASM + remote): `docs/react/dual-mode-setup.md`
- Inputs and filters: `docs/react/inputs.md`
- Topologies and multi-table: `docs/react/complex-setup.md`
- Core flow: `docs/core/data-flow.md`
- Grouped tables: `docs/react/grouped-table.md`
