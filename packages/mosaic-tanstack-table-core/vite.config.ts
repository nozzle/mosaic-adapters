import { defineConfig, mergeConfig } from 'vite';
import { tanstackViteConfig } from '@tanstack/config/vite';

const packageConfig = defineConfig({});

export default mergeConfig(
  packageConfig,
  tanstackViteConfig({
    cjs: false,
    entry: ['src/index.ts', 'src/trimmed/index.ts'],
    srcDir: './src',
  }),
);
