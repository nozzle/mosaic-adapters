import { defineConfig } from 'oxlint';

export default defineConfig({
  options: {
    typeAware: true,
  },
  plugins: ['typescript', 'unicorn', 'oxc', 'react', 'import'],
  categories: {
    correctness: 'error',
  },
  ignorePatterns: ['**/dist/**', '**/coverage/**'],
  rules: {
    // core
    curly: ['error', 'all'],
    'no-case-declarations': 'error',
    'no-empty-static-block': 'error',
    'no-fallthrough': 'error',
    'no-regex-spaces': 'error',
    'no-unused-private-class-members': 'error',
    'no-unused-vars': [
      'error',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'after-used',
        argsIgnorePattern: '^_',
      },
    ],
    'no-useless-backreference': 'error',
    'no-useless-catch': 'error',
    'no-useless-escape': 'error',
    'no-var': 'error',
    'prefer-const': 'error',
    'sort-imports': ['error', { ignoreDeclarationSort: true }],

    // typescript
    'typescript/array-type': [
      'error',
      { default: 'generic', readonly: 'generic' },
    ],
    'typescript/ban-ts-comment': [
      'error',
      { 'ts-expect-error': false, 'ts-ignore': 'allow-with-description' },
    ],
    'typescript/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', disallowTypeAnnotations: false },
    ],
    'typescript/method-signature-style': ['error', 'property'],
    'typescript/no-for-in-array': 'error',
    'typescript/no-inferrable-types': ['error', { ignoreParameters: true }],
    'typescript/no-namespace': 'error',
    'typescript/no-unnecessary-condition': 'error',
    'typescript/no-unnecessary-type-assertion': 'warn',
    'typescript/prefer-for-of': 'warn',
    'typescript/require-await': 'warn',
    'typescript/triple-slash-reference': 'error',

    // imports
    'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/no-commonjs': 'error',
    'import/no-duplicates': 'error',
    'unicorn/prefer-node-protocol': 'error',

    // react hooks + React Compiler (mirrors eslint-plugin-react-hooks
    // `recommended-latest`)
    'react/rules-of-hooks': 'error',
    'react/exhaustive-deps': 'warn',
    'react/error-boundaries': 'error',
    'react/globals': 'error',
    'react/immutability': 'error',
    'react/incompatible-library': 'warn',
    'react/preserve-manual-memoization': 'error',
    'react/purity': 'error',
    'react/refs': 'error',
    'react/set-state-in-effect': 'error',
    'react/set-state-in-render': 'error',
    'react/static-components': 'error',
    'react/unsupported-syntax': 'warn',
    'react/use-memo': 'error',
    'react/void-use-memo': 'error',

    // Rules from the `correctness` category that ESLint never enforced here.
    // Filter values are deliberately stringified from loosely typed payloads,
    // and the "useless" spreads snapshot collections that the loop body
    // mutates.
    'typescript/no-base-to-string': 'off',
    'typescript/restrict-template-expressions': 'off',
    'unicorn/no-useless-spread': 'off',
  },
  overrides: [
    {
      // The RTL calls awaited in tests are synchronous, but the awaits yield a
      // microtask that the hook assertions were written against.
      files: ['**/tests/**'],
      rules: {
        'typescript/await-thenable': 'off',
      },
    },
    {
      // These examples were not linted for React hooks under ESLint; surface
      // the existing findings without failing lint.
      files: ['examples/react/athletes/**', 'examples/react/nozzle-paa/**'],
      rules: {
        'react/set-state-in-effect': 'warn',
      },
    },
    {
      // The binding engine deliberately creates clients during render behind a
      // ref guard (the React-docs lazy-initialization pattern) so the client
      // exists on the first render; react/refs cannot see the guard.
      // use-mosaic-schema.ts applies the same pattern to the (setter-less)
      // schema client, and use-topology-helpers.ts to the composition handles.
      files: [
        'packages/react-mosaic/src/use-data-client.ts',
        'packages/react-mosaic/src/use-mosaic-schema.ts',
        'packages/react-mosaic/src/use-topology-helpers.ts',
      ],
      rules: {
        'react/refs': 'off',
      },
    },
  ],
});
