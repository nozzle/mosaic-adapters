import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

// DuckDB-WASM fetches the parquet from the browser, so standard CORS rules
// apply — and fastopendata.org sends no Access-Control-Allow-Origin header.
// Routing the request through the Vite server (dev and preview alike) strips
// the restriction.
const dataProxy = {
  '/data-proxy': {
    target: 'https://fastopendata.org',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/data-proxy/, ''),
  },
};

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: dataProxy,
  },
  preview: {
    proxy: dataProxy,
  },
});
