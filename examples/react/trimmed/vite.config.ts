import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [tsconfigPaths(), react(), tailwindcss()],
  optimizeDeps: {
    // Exclude workspace packages from pre-bundling to ensure changes are picked up immediately
    exclude: [
      '@nozzleio/mosaic-react-core',
      '@nozzleio/mosaic-tanstack-react-table',
      '@nozzleio/mosaic-tanstack-table-core',
    ],
  },
  server: {
    proxy: {
      // Proxy to bypass CORS on fastopendata.org
      // DuckDB-WASM makes requests directly from the browser, so standard fetch CORS rules apply.
      // Many public buckets do not have 'Access-Control-Allow-Origin: *' headers enabled.
      // This proxy routes the request through the Vite dev server, which strips CORS restrictions.
      '/data-proxy': {
        target: 'https://fastopendata.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/data-proxy/, ''),
      },
    },
  },
});
