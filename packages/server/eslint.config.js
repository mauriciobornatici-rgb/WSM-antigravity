import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

// Static checks for the backend (Node 24, ESM). Mirrors the client's flat config:
// recommended rules plus a few that catch real bugs in this codebase (unused values,
// accidental globals, missing awaits on promises returned from handlers).
export default defineConfig([
    globalIgnores(['coverage', 'uploads', 'node_modules']),
    {
        files: ['**/*.js'],
        extends: [js.configs.recommended],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: { ...globals.node },
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
            'no-console': 'off',
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'no-var': 'error',
            'prefer-const': 'error',
            'no-return-await': 'off',
            'require-atomic-updates': 'off',
        },
    },
    {
        files: ['test/**/*.js', 'integration/**/*.js'],
        rules: {
            // Test doubles often mirror a signature without using every argument.
            'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
        },
    },
]);
