// src/main.ts
import './app.css';
import App from './App.svelte';
import * as vg from '@uwdata/vgplot';

// --- START: NEW CONFIGURATION LOGIC ---

// Read the environment variable. Default to 'wasm' for better out-of-the-box experience.
const backend = import.meta.env.VITE_MOSAIC_BACKEND || 'wasm';

if (backend === 'wasm') {
  console.log('🚀 Initializing Svelte app with DuckDB-WASM backend...');
  vg.coordinator().databaseConnector(vg.wasmConnector());
} else {
  console.log('🚀 Initializing Svelte app with WebSocket server backend...');
  // Read the server URI from env, with a fallback for convenience.
  const serverUri =
    import.meta.env.VITE_MOSAIC_SERVER_URI || 'ws://localhost:3000';
  vg.coordinator().databaseConnector(vg.socketConnector(serverUri));
}

// --- END: NEW CONFIGURATION LOGIC ---

const app = new App({
  target: document.getElementById('app')!,
});

export default app;