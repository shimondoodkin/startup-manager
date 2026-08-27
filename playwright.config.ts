import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  timeout: 60000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure' },
});
