// ESLint flat config (task: lint & problems CI check). Broad, editor-matching linting so the
// "Problems" VS Code surfaces (via the ESLint + TypeScript extensions) reproduce in CI. Committing this
// config + the devDependencies is also what makes formerly local-only problems consistent everywhere:
// once `npm install` is run, the VS Code ESLint extension uses THESE rules, so local and CI agree.
//
// This is a forcing function — expect it to report many problems today. Fix them over time; do not
// weaken rules to go green.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    // Not source we author/lint: deps, build output, coverage, the committed history asset, generated types.
    ignores: [
      'node_modules/**',
      'dist/**',
      'bin/**',
      'coverage/**',
      'coverage-artifacts/**',
      'src/history/**',
      '.claude/**', // worktree-isolated spawned-agent checkouts (gitignored) — don't lint the nested repo copies
      '**/*.d.ts',
    ],
  },

  // Base JS + TypeScript recommended rules (the bulk of "ts extension lint problems").
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // TypeScript / React sources.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      import: importPlugin,
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
      // Resolve path aliases (game/*, util/*, …) through tsconfig so import rules understand them.
      'import/resolver': { typescript: { project: './tsconfig.json' } },
    },
    rules: {
      // Import hygiene (the "import problems"). TS itself already flags unresolved modules, so leave
      // import/no-unresolved off and focus on ordering/duplication that tsc doesn't cover. Enforce
      // group order (builtin -> external -> internal) but NOT within-group alphabetization or blank
      // lines — the codebase groups aliased imports by subsystem (game/types/json) with intentional
      // spacing, which reads better than a flat alphabetical list.
      'import/no-unresolved': 'off',
      'import/no-duplicates': 'error',
      'import/order': ['warn', { 'newlines-between': 'ignore' }],
      // Match the tsconfig convention: a leading underscore marks an intentionally-unused binding.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // React (tsx). jsx-runtime disables the legacy "React must be in scope" rule (React 18 automatic runtime).
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Tests: allow `require()` (jest lazy/isolated module loading in describe blocks) and `any` (mocks
  // and partial fixtures) — patterns that are idiomatic in the suite and not worth typing around.
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Node config/build/scripts (CommonJS + ESM) — Node globals, no browser/React.
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
