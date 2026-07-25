import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';

const authFile = path.join(__dirname, 'playwright', '.auth', 'user.json');
const baseURL = process.env['E2E_BASE_URL'] || 'http://127.0.0.1:4200';
const authenticated = {
  storageState: authFile,
  serviceWorkers: 'block' as const,
};

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { serviceWorkers: 'block' },
    },
    {
      name: 'android-chrome-4g',
      testMatch: /device-readiness\.spec\.ts/,
      metadata: { networkProfile: '4g' },
      use: { ...devices['Pixel 5'], ...authenticated, browserName: 'chromium' },
      dependencies: ['setup'],
    },
    {
      name: 'android-chrome-slow-4g',
      testMatch: /device-readiness\.spec\.ts/,
      metadata: { networkProfile: 'slow-4g' },
      use: { ...devices['Pixel 5'], ...authenticated, browserName: 'chromium' },
      dependencies: ['setup'],
    },
    {
      name: 'iphone-safari-wifi',
      testMatch: /device-readiness\.spec\.ts/,
      metadata: { networkProfile: 'wifi' },
      use: { ...devices['iPhone 13'], ...authenticated, browserName: 'webkit' },
      dependencies: ['setup'],
    },
    {
      name: 'iphone-safari-slow',
      testMatch: /device-readiness\.spec\.ts/,
      metadata: { networkProfile: 'slow-4g' },
      use: { ...devices['iPhone 13'], ...authenticated, browserName: 'webkit' },
      dependencies: ['setup'],
    },
    {
      name: 'tablet-chrome-portrait',
      testMatch: /device-readiness\.spec\.ts/,
      metadata: { networkProfile: 'wifi' },
      use: { ...authenticated, browserName: 'chromium', viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true },
      dependencies: ['setup'],
    },
    {
      name: 'tablet-chrome-landscape',
      testMatch: /device-readiness\.spec\.ts/,
      metadata: { networkProfile: 'wifi' },
      use: { ...authenticated, browserName: 'chromium', viewport: { width: 1194, height: 834 }, hasTouch: true, isMobile: true },
      dependencies: ['setup'],
    },
    {
      name: 'tablet-safari-portrait',
      testMatch: /device-readiness\.spec\.ts/,
      metadata: { networkProfile: 'wifi' },
      use: { ...devices['iPad Pro 11'], ...authenticated, browserName: 'webkit', viewport: { width: 834, height: 1194 } },
      dependencies: ['setup'],
    },
    {
      name: 'tablet-safari-landscape',
      testMatch: /device-readiness\.spec\.ts/,
      metadata: { networkProfile: 'wifi' },
      use: { ...devices['iPad Pro 11 landscape'], ...authenticated, browserName: 'webkit' },
      dependencies: ['setup'],
    },
    {
      name: 'laptop-chrome',
      testMatch: /device-readiness\.spec\.ts/,
      metadata: { networkProfile: 'broadband' },
      use: { ...devices['Desktop Chrome'], ...authenticated, browserName: 'chromium' },
      dependencies: ['setup'],
    },
    {
      name: 'laptop-edge',
      testMatch: /device-readiness\.spec\.ts/,
      metadata: { networkProfile: 'broadband' },
      use: { ...devices['Desktop Edge'], ...authenticated, browserName: 'chromium', channel: 'msedge' },
      dependencies: ['setup'],
    },
    {
      name: 'laptop-firefox',
      testMatch: /device-readiness\.spec\.ts/,
      metadata: { networkProfile: 'broadband' },
      use: { ...devices['Desktop Firefox'], ...authenticated, browserName: 'firefox' },
      dependencies: ['setup'],
    },
    {
      name: 'pwa-chromium',
      testMatch: /pwa\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], browserName: 'chromium', serviceWorkers: 'allow' },
    },
    {
      name: 'state-changing-chromium',
      testMatch: /state-changing-readiness\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], ...authenticated, browserName: 'chromium' },
      dependencies: ['setup'],
    },
  ],
});
