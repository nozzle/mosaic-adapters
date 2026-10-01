import { defineConfig } from 'vitest/config';

import packageJson from './package.json';

export default defineConfig({
  test: {
    name: packageJson.name,
    dir: './tests',
    watch: false,
    environment: 'node',
    testTimeout: 30_000,
    isolate: false,
    typecheck: { enabled: true },
  },
});
