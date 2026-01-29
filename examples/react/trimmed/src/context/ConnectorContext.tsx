import React, { createContext, useContext, useEffect, useState } from 'react';
import * as vg from '@uwdata/vgplot';
import { MosaicContext } from '@nozzleio/react-mosaic';
import { Coordinator, wasmConnector, decodeIPC } from '@uwdata/mosaic-core';

type ConnectorMode = 'wasm' | 'remote';

interface ConnectorContextType {
  mode: ConnectorMode;
  setMode: (mode: ConnectorMode) => void;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  error: string | null;
}

const ConnectorContext = createContext<ConnectorContextType | null>(null);

let effectCounter = 0;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Creates a custom connector that enforces Apache Arrow binary format.
 * This avoids overhead and parsing issues associated with row-oriented JSON.
 */
let connectorQueryId = 0;

function customRemoteConnector(url: string) {
  return {
    async query(queryInput: any) {
      const qid = ++connectorQueryId;
      let sql = queryInput;

      // Unpack SQL if it is wrapped in an object (e.g. by Coordinator's consolidator)
      if (typeof queryInput === 'object' && queryInput !== null) {
        // If the object already looks like our payload ({type: 'arrow', sql: ...}), extract the sql
        if (queryInput.sql) {
           sql = queryInput.sql;
        }
      }

      // Final safety check to ensure we send a string
      if (typeof sql !== 'string') {
          console.warn(`[Connector #${qid}] Received non-string SQL, attempting to stringify:`, sql);
          // If it's still an object at this point, it might be a Mosaic Query object, so we toString() it
          sql = String(sql);
      }

      const isDescQuery = sql.trim().toUpperCase().startsWith('DESC');
      const sqlPreview = sql.substring(0, 60);
      console.log(`[Connector #${qid}] → ${sqlPreview}...`);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, type: 'arrow' }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Remote query failed: ${response.status} ${response.statusText} - ${text}`);
      }

      const buffer = await response.arrayBuffer();
      console.log(`[Connector #${qid}] ← ${buffer.byteLength} bytes${isDescQuery ? ' (DESC)' : ''}`);

      // Decode Arrow IPC to a Table that Mosaic can iterate over
      const table = decodeIPC(buffer);
      console.log(`[Connector #${qid}] Decoded: ${table.numRows} rows`);

      return table;
    },
  };
}

/**
 * ConnectorProvider manages the lifecycle of the Mosaic Coordinator.
 * It handles switching between local WASM execution and remote HTTP execution (via a proxy).
 */
export function ConnectorProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ConnectorMode>('wasm');
  const [status, setStatus] = useState<'connected' | 'connecting' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [coordinator, setCoordinator] = useState<Coordinator>(() => vg.coordinator());

  const setMode = (newMode: ConnectorMode) => {
    if (newMode === mode) {
      return;
    }
    console.log(`[ConnectorProvider] Switching mode: ${mode} -> ${newMode}`);
    setStatus('connecting');
    setError(null);
    setModeState(newMode);
  };

  useEffect(() => {
    const effectId = ++effectCounter;
    let active = true;

    // Define the proxy URL centrally
    const PROXY_URL = 'http://localhost:3001/query';

    async function switchConnector() {
      try {
        console.group(`[ConnectorProvider][Effect #${effectId}] Switching to ${mode}`);
        let connector: any;

        if (mode === 'remote') {
          // 1. MANUAL PROXY TEST: Verify localhost:3001 is actually reachable from the browser
          try {
            console.log(`[Network Test] Pinging Proxy at ${PROXY_URL}...`);
            // We send a dummy query just to see if the server responds at all
            // Note: We use type: 'json' here just for a lightweight ping
            const testFetch = await fetch(PROXY_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'json', sql: 'SELECT 1' }),
            });
            console.log(
              `[Network Test] Proxy Response: ${testFetch.status} ${testFetch.statusText}`,
            );
          } catch (netErr: any) {
            console.error(
              `[Network Test] ❌ FAILED to reach Proxy at ${PROXY_URL}`,
              netErr,
            );
            throw new Error(
              `Cannot reach Proxy Server at ${PROXY_URL}. Is it running?`,
            );
          }

          // 2. INITIALIZE CUSTOM CONNECTOR
          console.log(`[Connector] Initializing custom Arrow connector...`);
          connector = customRemoteConnector(PROXY_URL);

        } else {
          console.log(`[Connector] Initializing WasmConnector`);
          connector = wasmConnector({ log: false });
        }

        if (!active) {
          console.groupEnd();
          return;
        }

        console.log(`[Coordinator] Creating fresh instance...`);
        const freshCoordinator = new Coordinator(connector, {
          cache: true,
          consolidate: true,
        });

        vg.coordinator(freshCoordinator);

        console.log(`[Health Check] Running 'SELECT 1'...`);
        // Use .query() to ensure the response parsing logic works end-to-end
        const healthCheckPromise = freshCoordinator.query(
          'SELECT 1 as health_check',
        );

        await withTimeout(healthCheckPromise, 5000, 'Health check');

        if (active) {
          console.log(`[ConnectorProvider] ✅ Connected successfully!`);
          setCoordinator(freshCoordinator);
          setStatus('connected');
        }
      } catch (e: any) {
        console.error(`[ConnectorProvider] ❌ Connection failed:`, e);
        if (active) {
          setError(e.message || String(e));
          setStatus('error');
        }
      } finally {
        console.groupEnd();
      }
    }

    switchConnector();

    return () => {
      active = false;
    };
  }, [mode]);

  return (
    <ConnectorContext.Provider value={{ mode, setMode, status, error }}>
      <MosaicContext.Provider value={coordinator}>
        {children}
      </MosaicContext.Provider>
    </ConnectorContext.Provider>
  );
}

export const useConnector = () => {
  const context = useContext(ConnectorContext);
  if (!context) {
    throw new Error(
      'useConnector must be used within ConnectorProvider',
    );
  }
  return context;
};