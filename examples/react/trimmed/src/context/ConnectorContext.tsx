// Updated to initialize in 'connecting' state to prevent initial load race conditions
import React, { createContext, useContext, useEffect, useState } from 'react';
import * as vg from '@uwdata/vgplot';
import { socketConnector, wasmConnector } from '@uwdata/mosaic-core';

type ConnectorMode = 'wasm' | 'remote';

interface ConnectorContextType {
  mode: ConnectorMode;
  setMode: (mode: ConnectorMode) => void;
  status: 'connected' | 'disconnected' | 'connecting';
}

const ConnectorContext = createContext<ConnectorContextType | null>(null);

export function ConnectorProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ConnectorMode>('wasm');
  // Initialize as 'connecting' so the UI waits for the useEffect to configure the coordinator
  const [status, setStatus] = useState<'connected' | 'connecting'>(
    'connecting',
  );

  // Wrapper to set status to 'connecting' immediately when mode changes.
  const setMode = (newMode: ConnectorMode) => {
    if (newMode === mode) {
      return;
    }
    setStatus('connecting');
    setModeState(newMode);
  };

  useEffect(() => {
    async function switchConnector() {
      // 1. Clear existing client state/cache in the coordinator
      vg.coordinator().clear();

      if (mode === 'remote') {
        console.log('Switching to Remote (Go) Connector...');
        // We cast to any to bypass TS definition mismatch (expecting object vs string)
        const connector = socketConnector('ws://localhost:3000/' as any);
        vg.coordinator().databaseConnector(connector);
      } else {
        console.log('Switching to WASM Connector...');
        const connector = wasmConnector({ log: false });
        vg.coordinator().databaseConnector(connector);
      }
      setStatus('connected');
    }

    switchConnector();
  }, [mode]);

  return (
    <ConnectorContext.Provider value={{ mode, setMode, status }}>
      {children}
    </ConnectorContext.Provider>
  );
}

export const useConnector = () => {
  const context = useContext(ConnectorContext);
  if (!context) {
    throw new Error('useConnector must be used within ConnectorProvider');
  }
  return context;
};
