import type { Page } from '@playwright/test';
import * as fs from 'fs';

export async function collectLighthouseReport(page: Page): Promise<string | null> {
  try {
    // Check if Lighthouse is disabled
    if (process.env.LIGHTHOUSE_DISABLED === 'true') {
      console.log('Lighthouse is disabled');
      return null;
    }

    // Get the current page URL
    const url = page.url();
    
    if (!url || url === 'about:blank') {
      console.error('Page URL is not valid for Lighthouse analysis');
      return null;
    }

    console.log(`Running Lighthouse on URL: ${url}`);

    // Use dynamic imports for ESM packages
    let lighthouse: any;
    let chromeLauncher: any;
    
    try {
      // Import lighthouse from the correct path
      const lighthouseModule = await import('lighthouse/core/index.js');
      lighthouse = lighthouseModule.default;
      
      // Import chrome-launcher from the correct path  
      chromeLauncher = await import('chrome-launcher/dist/index.js');
      console.log('Lighthouse dependencies loaded successfully');
    } catch (importError: any) {
      console.log('Lighthouse dependencies not available, skipping Lighthouse report:', importError?.message || importError);
      return null;
    }

    // Prepare Chrome launch options
    let launchOptions: any = {
      chromeFlags: [
        '--headless=new',
        '--no-sandbox', 
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--no-first-run',
        '--disable-default-apps',
        '--disable-web-security',
        '--allow-running-insecure-content',
      ],
    };

    // Use CHROME_PATH if available
    if (process.env.CHROME_PATH) {
      launchOptions.chromePath = process.env.CHROME_PATH;
      console.log(`Using Chrome from CHROME_PATH: ${process.env.CHROME_PATH}`);
    } else {
      // Try to find a Chrome executable
      const possiblePaths = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];
      
      for (const path of possiblePaths) {
        try {
          // Simple check if file exists and is executable
          await fs.promises.access(path, fs.constants.F_OK | fs.constants.X_OK);
          launchOptions.chromePath = path;
          console.log(`Found Chrome at: ${path}`);
          break;
        } catch (err) {
          // File doesn't exist or isn't executable, try next
          continue;
        }
      }
      
      if (!launchOptions.chromePath) {
        console.warn('No Chrome executable found, using chrome-launcher default');
      }
    }

    // Try to launch Chrome
    const chrome = await chromeLauncher.launch(launchOptions);
    console.log(`Chrome launched successfully on port ${chrome.port}`);

    const options = {
      port: chrome.port,
      output: 'html' as const,
      logLevel: 'error' as const,
      skipAuditNames: [
        'uses-http2',
        'redirects-http', 
        'uses-long-cache-ttl',
        'efficient-animated-content',
      ],
      extraHeaders: {},
    };
    
    // Run Lighthouse
    const runnerResult = await lighthouse(url, options);

    await chrome.kill();

    if (!runnerResult) {
      console.error('Lighthouse returned no result');
      return null;
    }

    const reportHtml = runnerResult.report;
    if (typeof reportHtml !== 'string') {
      console.error('Lighthouse report is not a string');
      return null;
    }
    
    console.log(`Lighthouse report generated successfully (${reportHtml.length} characters)`);
    return reportHtml;
  } catch (error: any) {
    console.error('Error collecting Lighthouse report:', error?.message || error);
    return null;
  }
}
