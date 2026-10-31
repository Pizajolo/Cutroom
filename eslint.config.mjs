import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import noShell from './scripts/eslint-no-shell.mjs';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'docs/schemas/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
    plugins: { security: { rules: { 'no-shell': noShell } } },
    rules: {
      'security/no-shell': 'error',
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'child_process', importNames: ['exec', 'execSync'], message: 'Use spawn/execFile with an argument array, never a shell.' },
          { name: 'node:child_process', importNames: ['exec', 'execSync'], message: 'Use spawn/execFile with an argument array, never a shell.' },
        ],
      }],
      'no-restricted-syntax': ['error',
        { selector: "Property[key.name='shell'][value.value=true]", message: 'shell: true is forbidden.' },
        { selector: "Property[key.value='shell'][value.value=true]", message: 'shell: true is forbidden.' },
        { selector: "CallExpression[callee.object.name='child_process'][callee.property.name=/^exec(Sync)?$/]", message: 'child_process.exec is forbidden.' },
      ],
    },
  },
  { files: ['**/*.{ts,tsx}'], rules: { 'no-undef': 'off' } },
  {
    files: ['src/{renderer,compositions}/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
