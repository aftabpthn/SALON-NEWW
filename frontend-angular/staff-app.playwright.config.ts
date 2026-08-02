import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /staff-app-certification\.spec\.ts/,
  outputDir: 'staff-app-test-results',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['line'], ['html', { outputFolder: 'staff-app-playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'staff-app-playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env['E2E_STAFF_BASE_URL'] || 'http://127.0.0.1:4320',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'staff-phone-chromium', use: { ...devices['Pixel 5'], browserName: 'chromium' } },
    { name: 'staff-phone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
});
