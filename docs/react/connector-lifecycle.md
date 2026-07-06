# Connector lifecycle recipe

The library ships exactly one piece of connection plumbing: [`MosaicProvider`](./hooks.md#provider-setup), which provisions a coordinator to the hooks below it. It deliberately stops there. **Which** connector backs that coordinator (DuckDB-WASM, a remote HTTP socket, a REST endpoint), when to retry, and what a reconnect means for page state are all app policy — they differ per deployment, so they live in your app, not in a package.

This recipe is the shape that policy takes: an app-owned `ConnectorProvider` that constructs its own `Coordinator`, hands it to `MosaicProvider`, and exposes a stable **connection identity** that downstream providers key on so everything resets cleanly on a reconnect. The reference implementation is [`examples/react/nozzle-paa/src/connector.tsx`](../../examples/react/nozzle-paa/src/connector.tsx) (the provider) plus the bootstrap gate in [`src/App.tsx`](../../examples/react/nozzle-paa/src/App.tsx).

## The connector provider

Construct the coordinator explicitly — `new Coordinator(connector)`, never the global singleton — so every client hook resolves _this_ instance through context. Track a `connectionId` that changes whenever the connector is rebuilt; that id is the connection's identity, and it is what downstream state keys on.

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { Coordinator, wasmConnector } from '@uwdata/mosaic-core';
import type { ReactNode } from 'react';

export interface ConnectorState {
  /** The app-owned coordinator; stable for the life of one connection. */
  coordinator: Coordinator;
  /** Changes whenever the connector is (re)created — key providers on this. */
  connectionId: number;
  /** Tear down the current connection and build a fresh one. */
  recreate: () => void;
}

const ConnectorContext = createContext<ConnectorState | null>(null);

/** Build a fresh coordinator wired to an in-browser DuckDB (WASM). */
function createConnection(): Coordinator {
  return new Coordinator(wasmConnector());
}

/** Owns the app's coordinator instance and its connection identity. */
export function ConnectorProvider(props: { children: ReactNode }) {
  const [connectionId, setConnectionId] = useState(0);

  // One coordinator per connectionId. Recreating it (a bumped id) yields a new
  // instance, so consumers keyed on connectionId remount against fresh state.
  const coordinator = useMemo(() => createConnection(), [connectionId]);

  const recreate = useCallback(() => {
    setConnectionId((id) => id + 1);
  }, []);

  const value = useMemo<ConnectorState>(
    () => ({ coordinator, connectionId, recreate }),
    [coordinator, connectionId, recreate],
  );

  return (
    <ConnectorContext.Provider value={value}>
      {props.children}
    </ConnectorContext.Provider>
  );
}

/** Read the current connector state; throws outside a ConnectorProvider. */
export function useConnector(): ConnectorState {
  const state = useContext(ConnectorContext);
  if (state === null) {
    throw new Error('useConnector must be used within a ConnectorProvider.');
  }
  return state;
}
```

`recreate()` bumps `connectionId`, the `useMemo` mints a new `Coordinator`, and every consumer keyed on the id remounts. That is the whole reconnect mechanism — no imperative teardown wiring, because remounting _is_ the teardown.

### Where a remote connector slots in

`createConnection` is the one place connector choice lives. Swapping DuckDB-WASM for a remote backend is a one-line change to that function — the provider contract (a `Coordinator` plus a `connectionId`) is unchanged:

```ts
import { Coordinator, socketConnector } from '@uwdata/mosaic-core';

function createConnection(): Coordinator {
  // A remote DuckDB / data server over a socket instead of in-browser WASM.
  return new Coordinator(socketConnector('wss://data.example.com/socket'));
}
```

Retry and reconnect are app policy layered on top: a `socketConnector` that drops its connection is exactly the case `recreate()` exists for. Wire a socket `onclose`/`onerror` (or a health-check ping) to call `recreate()`, and the connection-identity keying below does the rest — the whole page rebuilds against a fresh coordinator. The library takes no stance on _when_ to retry (immediate, backoff, user-triggered "Reconnect" button); that decision is yours.

## Gating and connection-identity keying

The connector provider owns only the coordinator identity. Readiness — the async data load — is layered on top via the [data loader](./data-loading.md), and the two combine into the app's single status gate. A small `Bootstrap` component derives `'connecting' | 'error' | 'ready'`, provides the coordinator through `MosaicProvider`, and **keys the downstream tree on `connectionId`**:

```tsx
import { MosaicProvider, MosaicTopologyProvider } from '@nozzleio/react-mosaic';
import { ConnectorProvider, useConnector } from './connector';
import { useDataLoad } from './data-loader';

function App() {
  // Own the coordinator lifecycle. Everything below resolves this explicit
  // coordinator (via MosaicProvider) instead of Mosaic's global.
  return (
    <ConnectorProvider>
      <Bootstrap />
    </ConnectorProvider>
  );
}

type BootstrapStatus = 'connecting' | 'error' | 'ready';

function Bootstrap() {
  const { coordinator, connectionId } = useConnector();
  const load = useDataLoad(coordinator, dataLoadConfig);
  const status: BootstrapStatus =
    load.error !== null ? 'error' : load.done ? 'ready' : 'connecting';

  return (
    <MosaicProvider coordinator={coordinator}>
      {/* Key on the connection identity: recreating the connector remounts the
          whole topology subtree, so it builds fresh Selections and no stale
          state survives against the new coordinator. */}
      <PageTopology key={connectionId} status={status} error={load.error} />
    </MosaicProvider>
  );
}
```

### Why key by connection identity

Selections, a filter set, and a [topology](./topology.md) are long-lived objects created inside React lifecycles and bound to _a_ coordinator's clients. When the connector is recreated, the old coordinator's clients are gone, but the Selection/topology instances that published clauses into them are not — they would keep pointing at a dead coordinator, publishing into nothing while the UI shows stale chips and ranges.

Keying the topology subtree on `connectionId` makes React unmount and remount it whenever the connection changes, so the page constructs fresh Selections against the fresh coordinator and no stale state leaks across a reconnect. This is the connection-scoped analogue of the identity-change teardown that [`useVgPlot`'s `deps`](./use-vg-plot.md#deps--rebuild-when-captured-identities-change) does for a single plot.

## The vgplot gotcha: bind plots to the provided coordinator

This one bit during the migration and is easy to miss. `useVgPlot` mounts whatever element the factory returns and disconnects its mark clients on unmount — it does **not** rebind those marks to the provider's coordinator. The bare `vg.plot(...)` / `vg.dot(...)` / `vg.rectY(...)` namespace builds marks against Mosaic's **global** singleton coordinator. So a plot built with the bare namespace inside an app that owns an explicit coordinator publishes and queries on the _wrong_ coordinator — it silently ignores the one in `MosaicProvider`.

Build plots through `vg.createAPIContext({ coordinator })` and use that context's factories (`api.plot`, `api.rectY`, `api.from`, `api.intervalX`, …) instead of the bare `vg.*` ones. Resolve the provided coordinator with `useMosaicCoordinator()`:

```tsx
import * as vg from '@uwdata/vgplot';
import { useMosaicCoordinator, useVgPlot } from '@nozzleio/react-mosaic';

function VolumePanel() {
  // Bare `vg.*` binds to the GLOBAL coordinator; this app owns an explicit one
  // via MosaicProvider. Build an API context bound to the resolved coordinator
  // so the marks and brush interactor live on the SAME coordinator as the hooks.
  const coordinator = useMosaicCoordinator();
  const api = useMemo(
    () => vg.createAPIContext({ coordinator }),
    [coordinator],
  );

  const attachPlot = useVgPlot(
    () =>
      api.plot(
        api.rectY(api.from(tableName, { filterBy: $context }), {
          x: api.bin('search_volume'),
          y: api.count(),
        }),
        api.intervalX({ as: $brush }),
      ),
    [api, $brush, $context],
  );

  return <div ref={attachPlot} />;
}
```

Two things to keep straight:

- Every mark and interactor must come from the same `api` context — mixing `api.rectY(...)` with a bare `vg.intervalX(...)` re-splits the plot across two coordinators.
- Include `api` in the `useVgPlot` deps so a recreated connection (new coordinator → new `api`) rebuilds the plot against the live coordinator. The full reference — including in-place resize and syncing the brush overlay to external clears — is the volume-brush panel in [`examples/react/nozzle-paa/src/components/volume-brush-panel.tsx`](../../examples/react/nozzle-paa/src/components/volume-brush-panel.tsx).

## See also

- [React hooks](./hooks.md#provider-setup) — coordinator resolution order (`coordinator` option → `MosaicProvider` → global) and `useMosaicCoordinator`.
- [Data loading](./data-loading.md) — the readiness half of the gate: serializable source config, sequential exec, and per-table status.
- [useVgPlot](./use-vg-plot.md) — mounting sugar, `deps`-driven rebuilds, and the `createAPIContext` note.
- [nozzle-paa](../../examples/react/nozzle-paa) — the wired reference (`src/connector.tsx`, `src/App.tsx`).
