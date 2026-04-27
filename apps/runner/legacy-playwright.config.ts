import { defineConfig, devices } from "@playwright/test";

/**
 * Legacy Playwright config for backwards-compat `legacy-run` action
 * command. Points at the preserved src/legacy tree so existing users
 * who adopt v2 without running the platform still get the same
 * Prometheus Pushgateway + S3 zipped-trace behavior they had in v1.
 */
export default defineConfig({
  testDir: process.env.TEST_DIR || "./src/legacy/tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.TEST_URL,
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
