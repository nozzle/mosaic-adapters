import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/index.ts', './src/vgplot/index.ts'],
  outDir: './dist/esm',
  format: ['esm'],
  target: 'es2022',
  tsconfig: './tsconfig.build.json',
  unbundle: true,
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  fixedExtension: false,
  publint: {
    strict: true,
  },
});
