import rootConfig from '../../eslint.config.js';

import { defineConfig } from 'eslint/config';

export default defineConfig([
  ...rootConfig,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
  },
]);
