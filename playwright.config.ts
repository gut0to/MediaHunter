import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/extension/test',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  timeout: 60_000,
});
