// src/main.ts
// This file is the main entry point for the Svelte application. It is only
// responsible for instantiating the root Svelte component and mounting it to the DOM.
// All Mosaic-related setup is handled within the component lifecycle.
import './app.css';
import App from './App.svelte';

const app = new App({
  target: document.getElementById('app')!,
});

export default app;