import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    watch: false,
    testTimeout: 30_000,
    isolate: false,
    typecheck: { enabled: true },
  },
  plugins: [react(), tailwindcss()],
});
