/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_MOSAIC_BACKEND?: 'wasm' | 'server';
    readonly VITE_MOSAIC_SERVER_URI?: string;
  }
  
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }