import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: process.env.TEST_DIR || './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: process.env.DISABLE_LIGHTHOUSE ? 60000 : 180000, // 1min without Lighthouse, 3min with Lighthouse
  reporter: [['html', { outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.TEST_URL,
    trace: 'off',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
});