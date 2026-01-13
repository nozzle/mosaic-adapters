import { defineConfig, mergeConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackViteConfig } from '@tanstack/vite-config';

const packageConfig = defineConfig({
  plugins: [react()],
});

export default mergeConfig(
  packageConfig,
  tanstackViteConfig({
    cjs: false,
    entry: ['src/index.ts'],
    srcDir: './src',
  }),
);
