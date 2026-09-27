import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 20000,
  reporter: 'list',
  globalTeardown: './tests/browser/teardown.ts',
  outputDir: '.qa/browser-results',
  use: { channel: 'msedge', headless: true, baseURL: 'http://127.0.0.1:4178', viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/browser-server.mjs', port: 4178, reuseExistingServer: false, timeout: 30000 }
});
