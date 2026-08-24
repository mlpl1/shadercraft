// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.worktrees/*'],
  },
  // Jest mocks must precede the modules they replace, so these patterns are test-only exceptions.
  {
    files: ['**/__tests__/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'import/first': 'off',
      'react-hooks/globals': 'off',
    },
  },
  // Keep compiler lint strict for new code while existing complex lifecycles are refactored.
  {
    files: [
      'src/app/editor.tsx',
      'src/app/library.tsx',
      'src/components/shader-file-drawer.tsx',
      'src/components/shader-sandbox.tsx',
    ],
    rules: { 'react-hooks/refs': 'off' },
  },
  {
    files: [
      'src/app/editor.tsx',
      'src/app/library.tsx',
      'src/app/tutorial.tsx',
      'src/components/stage-source-view.tsx',
      'src/context/course-context.tsx',
      'src/context/data-context.tsx',
      'src/context/progress-context.tsx',
      'src/context/sync-context.tsx',
    ],
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
  {
    files: ['src/components/stage-source-view.tsx'],
    rules: { 'react-hooks/preserve-manual-memoization': 'off' },
  },
]);
