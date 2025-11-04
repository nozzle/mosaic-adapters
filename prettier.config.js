// prettier.config.js
// This file provides the configuration for Prettier, the code formatter.
// It is written in plain JavaScript for maximum compatibility with all environments.

const config = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  plugins: ['prettier-plugin-svelte'],
  overrides: [
    {
      files: '*.svelte',
      options: {
        parser: 'svelte',
      },
    },
  ],
};

export default config;
