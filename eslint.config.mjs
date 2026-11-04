import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import ts from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', 'fixtures/**'] },
  { files: ['**/*.ts', '**/*.tsx'], extends: [js.configs.recommended, ...ts.configs.recommended] },
);
