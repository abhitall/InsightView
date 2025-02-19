import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const testDir = process.env.TEST_DIR || './tests';
const isSecurityScan = process.env.GITHUB_EVENT_NAME === 'schedule' || 
                      process.env.SCAN_TYPE === 'security' ||
                      process.env.SCAN_TYPE === 'both';

// Get ZAP proxy configuration
const zapHost = process.env.ZAP_HOST || 'localhost';
const zapPort = process.env.ZAP_PORT || '8080';
const zapProxy = `http://${zapHost}:${zapPort}`;

export default defineConfig({
  testDir,
  fullyParallel: !isSecurityScan, // Disable parallel execution for security scans
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: isSecurityScan ? 1 : undefined, // Single worker for security scans
  reporter: 'html',
  use: {
    baseURL: process.env.TEST_URL,
    trace: 'on',
    screenshot: 'on',
    video: 'retain-on-failure',
    storageState: process.env.AUTH_TYPE ? 'auth.json' : undefined,
    
    // Configure proxy settings for ZAP integration
    proxy: isSecurityScan ? {
      server: zapProxy
    } : undefined,

    // Increase timeouts for security scans
    navigationTimeout: isSecurityScan ? 120000 : 30000,
    actionTimeout: isSecurityScan ? 60000 : 15000,
    
    // Accept invalid certificates during security testing
    ignoreHTTPSErrors: isSecurityScan,

    // Enhanced context isolation
    contextOptions: {
      acceptDownloads: false,
      bypassCSP: false,
      strictSelectors: true
    }
  },
  
  // Increased timeouts for security scans
  timeout: isSecurityScan ? 4 * 60 * 60 * 1000 : 60000, // 4 hours for security scans
  expect: {
    timeout: isSecurityScan ? 60000 : 15000,
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