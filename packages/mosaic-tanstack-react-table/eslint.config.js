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
    rules: {
      '@eslint-react/no-unstable-context-value': 'off',
      '@eslint-react/no-unstable-default-props': 'off',
      '@eslint-react/dom/no-missing-button-type': 'off',
    },
  },
]);
