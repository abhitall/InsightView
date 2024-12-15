import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const testDir = process.env.TEST_DIR || './tests';

export default defineConfig({
  testDir,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.TEST_URL,
    trace: 'on',
    screenshot: 'on',
    video: 'retain-on-failure',
    storageState: process.env.AUTH_TYPE ? 'auth.json' : undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        storageState: process.env.AUTH_TYPE ? 'auth.json' : undefined,
      },
    },
    {
      name: 'mobile-chrome',
      use: { 
        ...devices['Pixel 5'],
        storageState: process.env.AUTH_TYPE ? 'auth.json' : undefined,
      },
    },
  ],
  globalSetup: process.env.AUTH_TYPE ? './global-setup.ts' : undefined,
});