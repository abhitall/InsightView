import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: process.env.TEST_DIR || './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.TEST_URL,
    trace: 'on',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        // Explicitly use chromium browser (full version, not headless shell)
        browserName: 'chromium',
      },
    },
    {
      name: 'mobile-chrome',
      use: { 
        ...devices['Pixel 5'],
        // Explicitly use chromium browser (full version, not headless shell)
        browserName: 'chromium',
      },
    },
  ],
});