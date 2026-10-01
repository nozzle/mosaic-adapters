import { defineConfig } from 'oxfmt';

export default defineConfig({
  singleQuote: true,
  sortImports: true,
  embeddedLanguageFormatting: 'auto',
  // Generated output that is not already covered by .gitignore.
  ignorePatterns: [
    '**/build',
    '**/snapshots',
    '**/test-results',
    '**/playwright-report',
    'examples/react/spec-dashboard/research',
  ],
});
