/**
 * App-owned connector lifecycle. The app constructs its OWN
 * {@link Coordinator} + DuckDB-WASM connector (no Mosaic global singleton) and
 * hands it to `MosaicProvider`, so every client hook resolves this explicit
 * instance via context. A stable `connectionId` identifies the current
 * connection: recreating the connector mints a new id, which downstream
 * providers key on so all Selection/topology state resets cleanly.
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

/** One coordinator instance paired with the id that minted it. */
interface Connection {
  coordinator: Coordinator;
  connectionId: number;
}

/** Build a fresh coordinator (wired to an in-browser DuckDB) for `connectionId`. */
function createConnection(connectionId: number): Connection {
  return { coordinator: new Coordinator(wasmConnector()), connectionId };
}

/** Owns the app's coordinator instance and its connection identity. */
export function ConnectorProvider(props: { children: ReactNode }) {
  // The coordinator and its id live in ONE state atom so a recreate swaps both
  // atomically; consumers keyed on connectionId remount against fresh state.
  const [connection, setConnection] = useState<Connection>(() =>
    createConnection(0),
  );

  const recreate = useCallback(() => {
    setConnection((prev) => createConnection(prev.connectionId + 1));
  }, []);

  const { coordinator, connectionId } = connection;
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
