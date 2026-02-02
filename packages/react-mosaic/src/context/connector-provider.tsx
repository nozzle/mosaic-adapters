import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as vg from '@uwdata/vgplot';
import { Coordinator, wasmConnector } from '@uwdata/mosaic-core';
import { MosaicContext } from '../context';

export type ConnectorMode = 'wasm' | 'remote';

export interface ConnectorConfig {
  mode: ConnectorMode;
  /** Factory to create the remote connector. Invoked only when mode is 'remote' */
  remoteConnectorFactory?: () => { query: (q: any) => Promise<any> };
  /** Options passed to wasmConnector */
  wasmOptions?: any;
}

interface ConnectorContextValue {
  mode: ConnectorMode;
  status: 'connecting' | 'connected' | 'error';
  error: string | null;
  /**
   * A unique hash that changes whenever the coordinator is re-initialized.
   * Use this as a React `key` on views to force them to reset state.
   */
  connectionId: string;
}

const ConnectorStateContext = createContext<ConnectorContextValue | null>(null);

/**
 * Manages the lifecycle of the Mosaic Coordinator.
 * Handles switching between local WASM execution and remote HTTP execution.
 * Provides connection status and a unique connection ID to signal database swaps.
 */
export function MosaicConnectorProvider({
  config,
  children,
}: {
  config: ConnectorConfig;
  children: React.ReactNode;
}) {
  const [coordinator, setCoordinator] = useState<Coordinator | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>(
    'connecting',
  );
  const [error, setError] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string>(() =>
    Math.random().toString(36),
  );

  // Track the current mode to detect changes during render
  const [currentMode, setCurrentMode] = useState<ConnectorMode>(config.mode);

  // Derived State Pattern:
  // If the prop `config.mode` disagrees with our internal `currentMode`,
  // we are in the middle of a transition. We must reset the state IMMEDIATELY
  // during render to prevent children from accessing the stale coordinator.
  if (config.mode !== currentMode) {
    setCurrentMode(config.mode);
    setStatus('connecting');
    setCoordinator(null); // Force coordinator to null so context consumers wait
    setError(null);
  }

  useEffect(() => {
    let active = true;

    // Ensure state is set to connecting at start of effect (idempotent with derived state above)
    setStatus('connecting');
    setError(null);

    async function init() {
      try {
        let connector;

        if (config.mode === 'remote') {
          if (!config.remoteConnectorFactory) {
            throw new Error(
              "Mode is 'remote' but no remoteConnectorFactory provided.",
            );
          }
          connector = config.remoteConnectorFactory();
        } else {
          connector = wasmConnector({
            log: false,
            ...config.wasmOptions,
          });
        }

        const nextCoordinator = new Coordinator(connector);
        vg.coordinator(nextCoordinator);

        // Health Check: Block for Remote, Optimistic for WASM
        if (config.mode === 'remote') {
          await nextCoordinator.query('SELECT 1');
        }

        if (active) {
          setCoordinator(nextCoordinator);
          setStatus('connected');
          setConnectionId(Math.random().toString(36));
        }
      } catch (err: any) {
        if (active) {
          console.error('[MosaicConnector] Init failed:', err);
          setError(err.message || String(err));
          setStatus('error');
        }
      }
    }

    init();
    return () => {
      active = false;
    };
  }, [config.mode, config.remoteConnectorFactory, config.wasmOptions]);

  const stateValue = useMemo(
    () => ({
      mode: config.mode,
      status,
      error,
      connectionId,
    }),
    [config.mode, status, error, connectionId],
  );

  return (
    <ConnectorStateContext.Provider value={stateValue}>
      <MosaicContext.Provider value={coordinator}>
        {children}
      </MosaicContext.Provider>
    </ConnectorStateContext.Provider>
  );
}

export const useConnectorStatus = () => {
  const ctx = useContext(ConnectorStateContext);
  if (!ctx) {
    throw new Error(
      'useConnectorStatus must be used within MosaicConnectorProvider',
    );
  }
  return ctx;
};
