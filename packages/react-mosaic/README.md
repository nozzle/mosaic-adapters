# `@nozzleio/react-mosaic`

React bindings for Mosaic coordinator and selection primitives.

## What lives here

- `MosaicContext`, `useCoordinator`, `useOptionalCoordinator`
- `MosaicConnectorProvider`, `useConnectorStatus`, `useMosaicCoordinator`
- `HttpArrowConnector`
- selection hooks such as `useMosaicSelection`, `useMosaicSelections`, `useCascadingContexts`, `useMosaicSelectionValue`
- `SelectionRegistryProvider`, `useSelectionRegistry`, `useRegisterSelections`

## What does not live here

Active-filter registry helpers are table-oriented and are exported from `@nozzleio/mosaic-tanstack-react-table`.
