import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    watch: false,
    testTimeout: 30_000,
    typecheck: { enabled: true },
  },
  plugins: [react(), tailwindcss()],
});
