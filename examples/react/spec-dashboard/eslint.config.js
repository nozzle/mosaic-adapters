import rootConfig from '../../../eslint.config.js';

import { defineConfig } from 'eslint/config';
import pluginReact from '@eslint-react/eslint-plugin';
import pluginReactHooks from 'eslint-plugin-react-hooks';

export default defineConfig([
  ...rootConfig,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
  },
  pluginReactHooks.configs.flat['recommended-latest'],
  {
    plugins: {
      '@eslint-react': pluginReact,
    },
  },
]);
