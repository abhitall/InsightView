import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import type { Page } from '@playwright/test';

export async function collectLighthouseReport(page: Page): Promise<string | null> {
  try {
    // Get the current page URL
    const url = page.url();
    
    if (!url || url === 'about:blank') {
      console.error('Page URL is not valid for Lighthouse analysis');
      return null;
    }

    // Check if we're in a CI environment and try to use the system Chrome
    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    let chrome;
    
    if (isCI) {
      // In CI, try to use the system Chrome that Playwright uses
      const chromePaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable', 
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        process.env.CHROME_PATH,
        '/ms-playwright/chromium-*/chrome-linux/chrome', // Playwright's Chrome
      ].filter(Boolean);
      
      for (const chromePath of chromePaths) {
        try {
          chrome = await launch({
            chromePath: chromePath as string,
            chromeFlags: [
              '--headless=new',
              '--no-sandbox', 
              '--disable-gpu',
              '--disable-dev-shm-usage',
              '--disable-extensions',
              '--no-first-run',
              '--disable-default-apps',
            ],
          });
          console.log(`Using Chrome at: ${chromePath}`);
          break;
        } catch (err) {
          console.log(`Failed to launch Chrome at ${chromePath}, trying next...`);
          continue;
        }
      }
      
      if (!chrome) {
        console.error('Could not find a working Chrome installation in CI');
        return null;
      }
    } else {
      // Local development - let chrome-launcher find Chrome
      chrome = await launch({
        chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
      });
    }

    const options = {
      port: chrome.port,
      output: 'html' as const,
      logLevel: 'error' as const,
      // Configure for CI environment
      skipAuditNames: ['uses-http2'],
      // Add authentication headers if needed (this will capture the current state)
      extraHeaders: {},
    };

    console.log(`Running Lighthouse on URL: ${url}`);
    
    // Run Lighthouse
    const runnerResult = await lighthouse(url, options);

    await chrome.kill();

    if (!runnerResult) {
      console.error('Lighthouse returned no result');
      return null;
    }

    // `.report` is the HTML report as a string
    const reportHtml = runnerResult.report;
    if (typeof reportHtml !== 'string') {
      console.error('Lighthouse report is not a string');
      return null;
    }
    
    console.log(`Lighthouse report generated successfully (${reportHtml.length} characters)`);
    return reportHtml;
  } catch (error) {
    console.error('Error collecting Lighthouse report:', error);
    return null;
  }
}
