/**
 * Recipe 1 — app-owned connector lifecycle.
 *
 * The app constructs its OWN {@link Coordinator} + DuckDB-WASM connector (no
 * Mosaic global singleton) and hands it to `MosaicProvider`, so every client
 * hook resolves this explicit instance via context. A stable `connectionId`
 * identifies the current connection: recreating the connector mints a new id,
 * which downstream providers key on so all Selection/topology state resets
 * cleanly against the fresh coordinator.
 *
 * This provider owns only the coordinator identity; readiness (the async data
 * load) is layered on top via the data loader (recipe 2), and the two combine
 * into the app's single status gate in `App.tsx`.
 */
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

/** Read the current connector state; throws outside a {@link ConnectorProvider}. */
export function useConnector(): ConnectorState {
  const state = useContext(ConnectorContext);
  if (state === null) {
    throw new Error('useConnector must be used within a ConnectorProvider.');
  }
  return state;
}
