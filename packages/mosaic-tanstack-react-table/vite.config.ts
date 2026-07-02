import { defineConfig, mergeConfig } from 'vitest/config';
import { tanstackViteConfig } from '@tanstack/vite-config';

const packageConfig = defineConfig({});

export default mergeConfig(
  packageConfig,
  tanstackViteConfig({
    cjs: false,
    entry: ['src/index.ts'],
    srcDir: './src',
  }),
);
