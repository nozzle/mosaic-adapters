import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Unit suites only; the Playwright e2e specs under tests/ run via test:e2e.
    include: ['tests/**/*.unit.test.tsx'],
    watch: false,
    environment: 'jsdom',
    testTimeout: 30_000,
    isolate: false,
    setupFiles: ['@nozzleio/test-support/setup-react'],
    typecheck: { enabled: true },
  },
  plugins: [react(), tailwindcss()],
});
