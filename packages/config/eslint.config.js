import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/src/generated/**',
      '**/.wrangler/**',
      'backend/**',
      'frontend/**',
      '**/*.tsbuildinfo',
      'apps/api/prisma/dev.db*',
      'apps/web/dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-console': 'off',
    },
  },
  {
    // Scripts e ferramentas: padrões de expressão (asserts, short-circuit)
    // e blocos vazios intencionais são comuns e aceitos aqui.
    files: ['**/scripts/**', '**/prisma/seed.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-unused-expressions': 'off',
      'no-empty': 'off',
    },
  },
);
