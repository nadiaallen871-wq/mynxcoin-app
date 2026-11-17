import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

/**
 * Financial modules must never use floating-point parsing for money.
 * This rule bans parseFloat / Number() / toFixed in ledger, wallet, payment and investment code.
 */
const noFloatMoney = {
  'no-restricted-globals': ['error', { name: 'parseFloat', message: 'Use utils/money.js (BigInt minor units) for financial values.' }],
  'no-restricted-properties': [
    'error',
    { object: 'Number', property: 'parseFloat', message: 'Use utils/money.js for financial values.' },
    { property: 'toFixed', message: 'toFixed rounds floats: use utils/money.js.' },
  ],
};

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '.devdata/**', 'server/prisma/migrations/**'] },
  js.configs.recommended,
  {
    files: ['server/**/*.js', 'infrastructure/**/*.mjs', 'e2e/**/*.js', '*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }] },
  },
  {
    // Playwright specs: Node test code plus page.evaluate callbacks that run in the browser.
    files: ['e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['server/src/utils/money.js', 'server/src/modules/{ledger,wallet,payments,investments,portfolio,transactions}/**/*.js'],
    rules: noFloatMoney,
  },
  {
    files: ['client/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['client/vite.config.js'],
    languageOptions: { globals: globals.node },
  },
  prettier,
];
