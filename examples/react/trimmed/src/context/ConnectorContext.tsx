// Context provider for managing the Mosaic Coordinator connection mode (WASM vs Remote)
// Handles switching connectors and tracking connection status.

import React, { createContext, useContext, useEffect, useState } from 'react';
import * as vg from '@uwdata/vgplot';
import { MosaicContext } from '@nozzleio/react-mosaic';
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
  const [status, setStatus] = useState<'connected' | 'connecting'>(
    'connecting',
  );

  const setMode = (newMode: ConnectorMode) => {
    if (newMode === mode) {
      return;
    }
    setStatus('connecting');
    setModeState(newMode);
  };

  useEffect(() => {
    async function switchConnector() {
      // 1. Clear existing client state
      vg.coordinator().clear();

      if (mode === 'remote') {
        console.log('Switching to Remote (Go) Connector...');
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

  // We provide the global coordinator instance to the MosaicContext.
  // This allows all child hooks to access it implicitly.
  const coordinator = vg.coordinator();

  return (
    <ConnectorContext.Provider value={{ mode, setMode, status }}>
      <MosaicContext.Provider value={coordinator}>
        {children}
      </MosaicContext.Provider>
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
