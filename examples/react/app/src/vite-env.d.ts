// examples/react/app/src/vite-env.d.ts
// This file provides TypeScript definitions for environment variables exposed by Vite.
// It ensures type safety and autocompletion for `import.meta.env`.

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOSAIC_BACKEND: 'wasm' | 'server';
  readonly VITE_MOSAIC_SERVER_URI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
