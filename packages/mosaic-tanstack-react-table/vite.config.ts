import { defineConfig, mergeConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackViteConfig } from '@tanstack/config/vite';

const packageConfig = defineConfig({
  plugins: [react() as any],
});

export default mergeConfig(
  packageConfig,
  tanstackViteConfig({
    cjs: false,
    entry: ['src/index.ts'],
    srcDir: './src',
  }),
);
