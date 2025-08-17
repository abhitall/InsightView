import type { Page } from '@playwright/test';

export async function collectLighthouseReport(page: Page): Promise<string | null> {
  try {
    // Check if Lighthouse is disabled
    if (process.env.LIGHTHOUSE_DISABLED === 'true') {
      console.log('Lighthouse is disabled (Chrome not found)');
      return null;
    }

    // Get the current page URL
    const url = page.url();
    
    if (!url || url === 'about:blank') {
      console.error('Page URL is not valid for Lighthouse analysis');
      return null;
    }

    console.log(`Running Lighthouse on URL: ${url}`);

    // Use eval to prevent TypeScript from checking these imports at compile time
    let lighthouse: any;
    let chromeLauncher: any;
    
    try {
      const lighthouseModule = await eval('import("lighthouse")');
      lighthouse = lighthouseModule.default;
      chromeLauncher = await eval('import("chrome-launcher")');
    } catch (importError) {
      console.log('Lighthouse dependencies not available, skipping Lighthouse report');
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
          const fs = await eval('import("fs")');
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
