import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Server (Node + Workers). The console and e2e projects have their own configs.
// Formatting is owned by Prettier (eslint-config-prettier turns the conflicting
// stylistic rules off), so ESLint here only catches real problems.
export default tseslint.config(
  {
    ignores: [
      'dist/',
      'src/generated/',
      'node_modules/',
      'console/',
      'e2e/',
      'static/',
      'drizzle/',
      '**/*.config.{js,mjs,ts}',
      // local working dirs (also git-ignored) — never lint these
      '.design-sync/',
      '.design-review/',
      '.ds-sync/',
      '.devdata/',
      'brand/',
      'ds-bundle/',
      'ds-bundle-v1/',
      'ds-bundle-comments/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  prettier,
);
