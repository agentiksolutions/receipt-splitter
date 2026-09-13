// Flat config, eslint 9. Two blocks: the app runs in a browser, the test files
// run in node. Nothing here is stylistic; formatting is not eslint's job.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },

  {
    files: ['src/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // This one is here because of a real bug: a `const byId` inside a map
      // shadowed the `const byId` above it and left the home page stuck on the
      // skeleton. Build green, every check green, page dead.
      'no-shadow': 'error',
      // The thirteen React imports are unused under the automatic JSX runtime.
      // Deleting them is a separate cleanup, not a review fix.
      'no-unused-vars': ['error', { varsIgnorePattern: '^React$' }]
    }
  },

  {
    // Same rules for JSX, with one relaxation. eslint parses JSX but does not
    // know that <Split /> is a use of Split; the rule that teaches it lives in
    // eslint-plugin-react, which is not installed. Ignoring PascalCase names
    // here costs the ability to spot a genuinely unused component import, and
    // buys back sixty false errors. The .js block above stays strict.
    files: ['src/**/*.jsx'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-shadow': 'error',
      'no-unused-vars': ['error', { varsIgnorePattern: '^([A-Z]|React$)' }]
    }
  },

  {
    files: ['src/**/*.test.js', 'eslint.config.js'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node }
  }
];
