import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Coordinator,
  coordinator as globalCoordinator,
  wasmConnector,
} from '@uwdata/mosaic-core';
import { MosaicContext } from '../context';
import type { Connector } from '@uwdata/mosaic-core';
import type { ReactNode } from 'react';

export type ConnectorMode = 'wasm' | 'remote';

interface ConnectorContextValue {
  mode: ConnectorMode;
  setMode: (mode: ConnectorMode) => void;
  status: 'connecting' | 'connected' | 'error';
  error: Error | null;
  connectionId: string;
}

const ConnectorStateContext = createContext<ConnectorContextValue | null>(null);

export interface MosaicConnectorProviderProps {
  /** Initial connector mode. @default 'wasm' */
  initialMode?: ConnectorMode;
  /** Factory to create the remote connector. Invoked only when mode is 'remote'. */
  remoteConnectorFactory?: () => Connector;
  /** Options passed to wasmConnector (e.g. { duckdb: db }). Pass `null` to defer init. */
  wasmOptions?: Record<string, unknown> | null;
  /** Enable verbose Coordinator logging to the console. @default false */
  debug?: boolean;
  children: ReactNode;
}

/**
 * Manages the lifecycle of the Mosaic Coordinator.
 * Handles switching between local WASM execution and remote HTTP execution.
 * Self-contained: owns the mode state internally.
 */
export function MosaicConnectorProvider({
  initialMode = 'wasm',
  remoteConnectorFactory,
  wasmOptions,
  debug = false,
  children,
}: MosaicConnectorProviderProps) {
  const [mode, setModeRaw] = useState<ConnectorMode>(initialMode);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>(
    'connecting',
  );
  const [error, setError] = useState<Error | null>(null);
  const [connectionId, setConnectionId] = useState<string>(() =>
    Math.random().toString(36),
  );

  // Track { instance, mode } tuple for stale filtering
  const [coordinatorState, setCoordinatorState] = useState<{
    instance: Coordinator;
    mode: ConnectorMode;
  } | null>(null);

  // Wrap setMode to synchronously reset status in the same render batch.
  // Without this, there is a single render where mode has changed (so
  // activeCoordinator = null due to mode mismatch) but status is still
  // 'connected', causing isMosaicInitialized to be true while the
  // coordinator is null — downstream guards pass and hooks throw.
  const setMode = useCallback((newMode: ConnectorMode) => {
    setModeRaw(newMode);
    setStatus('connecting');
  }, []);

  // Store props in refs so the effect can read the latest values
  // without re-triggering when irrelevant props change.
  const remoteFactoryRef = useRef(remoteConnectorFactory);
  remoteFactoryRef.current = remoteConnectorFactory;
  const wasmOptionsRef = useRef(wasmOptions);
  wasmOptionsRef.current = wasmOptions;
  const debugRef = useRef(debug);
  debugRef.current = debug;

  // Derive a boolean that is true when wasm prerequisites are met.
  // undefined (not passed) = "use defaults", null = "defer init"
  const wasmReady = mode === 'wasm' ? wasmOptions !== null : true;

  useEffect(() => {
    setError(null);

    // WASM gating: wait for wasmOptions when explicitly null (deferred)
    if (mode === 'wasm' && wasmOptionsRef.current === null) {
      return;
    }

    let active = true;
    setStatus('connecting');

    async function init() {
      try {
        let connector;

        if (mode === 'remote') {
          const factory = remoteFactoryRef.current;
          if (!factory) {
            throw new Error(
              "Mode is 'remote' but no remoteConnectorFactory provided.",
            );
          }
          connector = factory();
        } else {
          connector = wasmConnector({
            log: false,
            ...wasmOptionsRef.current,
          });
        }

        const coord = new Coordinator(connector, {
          preagg: { enabled: true },
        });

        if (debugRef.current) {
          coord.logger({
            log: (...args: Array<unknown>) => console.log('[Mosaic]', ...args),
            info: (...args: Array<unknown>) =>
              console.info('[Mosaic]', ...args),
            warn: (...args: Array<unknown>) =>
              console.warn('[Mosaic]', ...args),
            error: (...args: Array<unknown>) =>
              console.error('[Mosaic]', ...args),
            debug: (...args: Array<unknown>) =>
              console.debug('[Mosaic]', ...args),
            group: (label?: unknown) => console.group(label as string),
            groupCollapsed: (label?: unknown) =>
              console.groupCollapsed(label as string),
            groupEnd: () => console.groupEnd(),
          });
        }

        // Register as global singleton
        globalCoordinator(coord);

        // Health Check: Block for Remote, Optimistic for WASM
        if (mode === 'remote') {
          await coord.query('SELECT 1');
        }

        if (active) {
          setCoordinatorState({ instance: coord, mode });
          setStatus('connected');
          setConnectionId(Math.random().toString(36));
        }
      } catch (err: unknown) {
        if (active) {
          console.error('[MosaicConnector] Init failed:', err);
          setError(err instanceof Error ? err : new Error(String(err)));
          setStatus('error');
          setCoordinatorState(null);
        }
      }
    }

    init();
    return () => {
      active = false;
    };
    // `mode` — re-init when switching wasm ↔ remote
    // `wasmReady` — re-init when wasm prerequisites appear (false→true)
    // Props are read from refs, so changes to remoteConnectorFactory or
    // wasmOptions reference do NOT cause spurious re-initialization.
  }, [mode, wasmReady]);

  // Derived: only expose the coordinator if its mode matches the current mode
  const activeCoordinator =
    coordinatorState?.mode === mode ? coordinatorState.instance : null;

  const stateValue = useMemo(
    () => ({
      mode,
      setMode,
      status,
      error,
      connectionId,
    }),
    [mode, setMode, status, error, connectionId],
  );

  return (
    <ConnectorStateContext.Provider value={stateValue}>
      <MosaicContext.Provider value={activeCoordinator}>
        {children}
      </MosaicContext.Provider>
    </ConnectorStateContext.Provider>
  );
}

/**
 * Access the connector status context (mode, setMode, status, error, connectionId).
 */
export const useConnectorStatus = () => {
  const ctx = useContext(ConnectorStateContext);
  if (!ctx) {
    throw new Error(
      'useConnectorStatus must be used within MosaicConnectorProvider',
    );
  }
  return ctx;
};

/**
 * Drop-in replacement for explorer-mosaic's useMosaicCoordinator().
 * Returns { coordinator, mode, setMode, status, error, connectionId, isMosaicInitialized }.
 */
export function useMosaicCoordinator() {
  const coordinator = useContext(MosaicContext);
  const ctx = useConnectorStatus();
  return {
    coordinator,
    ...ctx,
    // Both conditions required: status must be 'connected' AND an active
    // coordinator must exist. During mode transitions the coordinator is
    // nullified before the new one is ready — guards that check this flag
    // must block rendering until both are satisfied.
    isMosaicInitialized: ctx.status === 'connected' && coordinator !== null,
  };
}
