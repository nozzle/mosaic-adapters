import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import packageJson from './package.json';

export default defineConfig({
  plugins: [react()],
  test: {
    name: packageJson.name,
    dir: './tests',
    watch: false,
    environment: 'jsdom',
    testTimeout: 30_000,
    isolate: false,
    setupFiles: ['@nozzleio/test-support/setup-react'],
    typecheck: { enabled: true },
  },
});
