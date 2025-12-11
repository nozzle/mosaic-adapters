import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [tsconfigPaths(), react(), tailwindcss()],
  server: {
    proxy: {
      // Proxy to bypass CORS on fastopendata.org
      '/data-proxy': {
        target: 'https://fastopendata.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/data-proxy/, ''),
      },
    },
  },
});