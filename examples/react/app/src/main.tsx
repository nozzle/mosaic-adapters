// This file is the main entry point for the application. It performs the initial, one-time
// setup for Mosaic's global coordinator and then bootstraps the root React component (`<App />`).
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as vg from '@uwdata/vgplot';
import App from './App';
import './ui/table-styles.css'; // Import the new stylesheet

// --- Switchable Mosaic Backend Configuration ---

// Read the environment variable. Default to 'wasm' if not set.
const backend = import.meta.env.VITE_MOSAIC_BACKEND || 'wasm';

if (backend === 'wasm') {
  console.log('🚀 Initializing Mosaic with DuckDB-WASM backend...');
  vg.coordinator().databaseConnector(vg.wasmConnector());
} else {
  console.log('🚀 Initializing Mosaic with WebSocket server backend...');
  // Read the server URI from env, with a fallback for convenience.
  const serverUri =
    import.meta.env.VITE_MOSAIC_SERVER_URI || 'ws://localhost:3000';
  vg.coordinator().databaseConnector(vg.socketConnector(serverUri));
}

// --- End Configuration ---

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
