# `@nozzleio/react-mosaic`

React bindings for Mosaic coordinators, connector lifecycle, and selections.

This package owns the shared React context used by the Mosaic adapters. Use it to create or switch coordinators, create stable selections, observe selection values, and register selections for reset flows.

## Install

```bash
npm install @nozzleio/react-mosaic react
```

## What lives here

- `MosaicContext`, `useCoordinator`, `useOptionalCoordinator`
- `MosaicConnectorProvider`, `useConnectorStatus`, `useMosaicCoordinator`
- `useRequireMode`
- `useMosaicSelection`, `useMosaicSelections`, `useCascadingContexts`
- `useMosaicSelectionValue`, `useSelectionListener`
- `SelectionRegistryProvider`, `useSelectionRegistry`, `useRegisterSelections`
- `useMosaicClient`
- `HttpArrowConnector`

```tsx
import {
  MosaicConnectorProvider,
  useConnectorStatus,
  useMosaicSelection,
  useRequireMode,
} from '@nozzleio/react-mosaic';

function RemoteView() {
  const ready = useRequireMode('remote');
  const { status } = useConnectorStatus();
  const selection = useMosaicSelection();

  if (!ready || status !== 'connected') {
    return null;
  }

  return <button onClick={() => selection.reset()}>Reset selection</button>;
}

function App() {
  return (
    <MosaicConnectorProvider initialMode="wasm">
      <RemoteView />
    </MosaicConnectorProvider>
  );
}
```

## Notes

- `useRequireMode()` returns a boolean readiness signal. Components that query immediately should still guard on that result before using coordinator-dependent clients.
- `useMosaicSelectionValue(selection, { source })` can read a source-scoped selection snapshot when a component needs the value for a specific Mosaic client instead of the shared selection value.
- `HttpArrowConnector` is exported from the package root for now even though it is not itself a React hook.
- Table-specific active-filter helpers do not live here. Import `MosaicFilterProvider`, `useFilterRegistry`, `useActiveFilters`, and `useRegisterFilterSource` from `@nozzleio/mosaic-tanstack-react-table`.
