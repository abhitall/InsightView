import type { Page } from '@playwright/test';

export async function collectLighthouseReport(page: Page): Promise<string | null> {
  try {
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

    // Try to use chrome-launcher's default Chrome finding logic
    const chrome = await chromeLauncher.launch({
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
    });

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
