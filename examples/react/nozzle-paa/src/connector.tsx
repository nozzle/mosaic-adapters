import { Coordinator, wasmConnector } from '@uwdata/mosaic-core';
import type { DuckDBWASMConnector } from '@uwdata/mosaic-core';
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
 * The connection is created in an effect (never `useMemo`) so every connection
 * has a matching cleanup: the coordinator is cleared and the DuckDB-WASM Web
 * Worker terminated — but only if DuckDB actually started. Without that
 * cleanup each reconnect (and each StrictMode remount) leaks a worker.
 *
 * Teardown order: clients → topology → `coordinator.clear()` → terminate the
 * worker. The subtree using the connection is unmounted first (its clients
 * disconnect and its topology is destroyed silently), and the connection is
 * disposed afterwards.
 *
 * This provider owns only the coordinator identity; readiness (the async data
 * load) is layered on top via the data loader (recipe 2), and the two combine
 * into the app's single status gate in `App.tsx`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

/** One live connection: the coordinator plus the connector it owns. */
interface Connection {
  id: number;
  coordinator: Coordinator;
  connector: DuckDBWASMConnector;
}

/** Build a fresh coordinator wired to an in-browser DuckDB (WASM). */
function createConnection(id: number): Connection {
  // `wasmConnector()` is lazy: no Web Worker starts until the first query.
  const connector = wasmConnector();
  return { id, coordinator: new Coordinator(connector), connector };
}

/**
 * Dispose a connection whose clients and topology are already gone: clear the
 * coordinator (cancel queued queries, disconnect any straggling client, drop
 * the cache), then terminate DuckDB — only if it started. `_loadPromise` is set
 * by the connector on its first query; a connection that never queried (e.g.
 * the throwaway StrictMode mount) has no worker to terminate.
 */
function disposeConnection(connection: Connection): void {
  connection.coordinator.clear();

  const { connector } = connection;
  const loading = connector._loadPromise;
  if (loading === undefined) {
    return;
  }
  // Wait for an in-flight start to settle, then terminate the instance it
  // produced. A start that failed after instantiation (opening or connecting)
  // still leaves `_db` set, so its worker is reclaimed. A start that failed
  // during instantiation never assigns `_db` (upstream sets it only on success),
  // so that worker is unreachable from here and cannot be terminated.
  void loading
    .catch(() => undefined)
    .then(() => connector._db?.terminate())
    .catch((error: unknown) => {
      console.warn('[nozzle-paa] Failed to terminate DuckDB-WASM.', error);
    });
}

/** Owns the app's coordinator instance and its connection identity. */
export function ConnectorProvider(props: { children: ReactNode }) {
  const [generation, setGeneration] = useState(0);
  const [connection, setConnection] = useState<Connection | null>(null);

  // One connection per generation, created and disposed by the same effect.
  // Disposal is deferred to a microtask so it runs after every other cleanup
  // in the same commit — the subtree using this connection (its clients and
  // its topology) is always torn down first, even when this provider itself
  // unmounts (React runs deleted-tree cleanups parent-first).
  useEffect(() => {
    const next = createConnection(generation);
    // Deliberate: the connection must be created here so it has a matching
    // cleanup below (a `useMemo` connection would have none).
    // oxlint-disable-next-line react/set-state-in-effect
    setConnection(next);
    return () => {
      queueMicrotask(() => disposeConnection(next));
    };
  }, [generation]);

  const recreate = useCallback(() => {
    setGeneration((id) => id + 1);
  }, []);

  // A connection from an older generation is about to be disposed: render
  // nothing against it, so its subtree unmounts before the coordinator clears.
  const current = connection !== null && connection.id === generation ? connection : null;

  const value = useMemo<ConnectorState | null>(
    () =>
      current === null
        ? null
        : { coordinator: current.coordinator, connectionId: current.id, recreate },
    [current, recreate],
  );

  if (value === null) {
    return null;
  }
  return <ConnectorContext.Provider value={value}>{props.children}</ConnectorContext.Provider>;
}

/** Read the current connector state; throws outside a {@link ConnectorProvider}. */
export function useConnector(): ConnectorState {
  const state = useContext(ConnectorContext);
  if (state === null) {
    throw new Error('useConnector must be used within a ConnectorProvider.');
  }
  return state;
}
