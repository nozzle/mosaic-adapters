import rootConfig from '../../eslint.config.js';

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
  {
    // The binding engine deliberately creates clients during render behind a
    // ref guard (the React-docs lazy-initialization pattern) so the client
    // exists on the first render; react-hooks/refs cannot see the guard.
    files: ['src/use-data-client.ts'],
    rules: {
      'react-hooks/refs': 'off',
    },
  },
]);
