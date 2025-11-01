// src/main.ts
// This file is the main entry point for the Svelte application. It performs the initial, one-time
// setup for Mosaic's global coordinator and then bootstraps the root Svelte component (`App.svelte`).
import './app.css';
import App from './App.svelte';
import * as vg from '@uwdata/vgplot';

// Perform the one-time, global Mosaic setup here.
// This configures the coordinator that our Svelte app will later consume.
vg.coordinator().databaseConnector(vg.socketConnector('ws://localhost:3000'));

const app = new App({
  target: document.getElementById('app')!,
});

export default app;
