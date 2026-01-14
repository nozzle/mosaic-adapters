import { defineConfig, mergeConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { tanstackViteConfig } from '@tanstack/vite-config';

import packageJson from './package.json';

const packageConfig = defineConfig({
  plugins: [react()],
  test: {
    name: packageJson.name,
    dir: './tests',
    watch: false,
    environment: 'jsdom',
    typecheck: { enabled: true },
  },
});

export default mergeConfig(
  packageConfig,
  tanstackViteConfig({
    cjs: false,
    entry: ['src/index.ts'],
    srcDir: './src',
  }),
);
