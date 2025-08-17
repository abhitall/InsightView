import type { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export async function collectLighthouseReport(page: Page): Promise<string | null> {
  let chrome = null;
  
  try {
    // Dynamic imports to avoid compile-time dependency issues
    const lighthouse = (await import('lighthouse')).default;
    const chromeLauncher = await import('chrome-launcher');
    
    const url = page.url();
    
    if (!url || url === 'about:blank') {
      console.error('Page URL is not valid for Lighthouse analysis');
      return null;
    }

    console.log(`Starting Lighthouse analysis for: ${url}`);

    // Find Chrome executable
    const chromePaths = [
      process.env.CHROME_PATH,
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ].filter(Boolean);

    // Try to find Playwright's chromium using find command
    try {
      const playwrightChrome = execSync('find /ms-playwright -name "chrome" -type f 2>/dev/null | head -1', { encoding: 'utf8' }).trim();
      if (playwrightChrome) {
        chromePaths.push(playwrightChrome);
      }
    } catch (e) {
      // Ignore find errors
    }

    let chromePath = null;
    for (const pathToCheck of chromePaths) {
      if (pathToCheck && fs.existsSync(pathToCheck)) {
        // Verify the file is executable
        try {
          fs.accessSync(pathToCheck, fs.constants.X_OK);
          chromePath = pathToCheck;
          break;
        } catch (e) {
          console.log(`Chrome at ${pathToCheck} is not executable`);
        }
      }
    }

    if (!chromePath) {
      // Try to find any chrome executable using which
      try {
        const whichChrome = execSync('which google-chrome || which chromium || which chromium-browser', { encoding: 'utf8' }).trim();
        if (whichChrome && fs.existsSync(whichChrome)) {
          chromePath = whichChrome;
        }
      } catch (e) {
        // Ignore which errors
      }
    }

    if (!chromePath) {
      throw new Error(`No Chrome executable found. Checked paths: ${chromePaths.join(', ')}`);
    }

    console.log(`Using Chrome at: ${chromePath}`);

    // Extract cookies from Playwright page to maintain authentication
    const cookies = await page.context().cookies();
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Launch Chrome with optimal configuration for Lighthouse
    chrome = await chromeLauncher.launch({
      chromePath: chromePath as string,
      chromeFlags: [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--enable-features=NetworkService,NetworkServiceLogging',
        '--force-color-profile=srgb',
        '--metrics-recording-only',
        '--no-first-run',
        '--use-mock-keychain',
        '--disable-default-apps',
        '--disable-component-extensions-with-background-pages',
      ],
    });

    console.log(`Chrome launched on port: ${chrome.port}`);

    // Configure Lighthouse options based on official docs
    const options = {
      logLevel: 'info' as const,
      output: 'html' as const,
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      port: chrome.port,
      // Include authentication headers
      extraHeaders: cookieString ? { Cookie: cookieString } : undefined,
      // CI-specific configurations
      skipAuditNames: [
        'screenshot-thumbnails', // Skip screenshots in CI to reduce size
        'final-screenshot',
        'uses-http2', // May not be available in test environments
      ],
      // Performance and reliability settings
      throttlingMethod: 'simulate' as const,
      throttling: {
        rttMs: 40,
        throughputKbps: 10240,
        cpuSlowdownMultiplier: 1,
        requestLatencyMs: 0,
        downloadThroughputKbps: 0,
        uploadThroughputKbps: 0,
      },
      // Form factor for consistent results
      formFactor: 'desktop' as const,
      screenEmulation: {
        mobile: false,
        width: 1350,
        height: 940,
        deviceScaleFactor: 1,
        disabled: false,
      },
      // Additional settings for reliability
      maxWaitForFcp: 15 * 1000,
      maxWaitForLoad: 35 * 1000,
      pauseAfterFcpMs: 1000,
      pauseAfterLoadMs: 1000,
      networkQuietThresholdMs: 1000,
      cpuQuietThresholdMs: 1000,
    };

    console.log('Running Lighthouse audit...');
    
    // Run Lighthouse with the configured options
    const runnerResult = await lighthouse(url, options);

    if (!runnerResult) {
      throw new Error('Lighthouse returned no result');
    }

    // Extract the HTML report
    const reportHtml = runnerResult.report;
    if (typeof reportHtml !== 'string') {
      throw new Error('Lighthouse report is not a string');
    }

    console.log(`Lighthouse report generated successfully (${Math.round(reportHtml.length / 1024)}KB)`);
    
    // Log key metrics for debugging
    if (runnerResult.lhr) {
      const { categories } = runnerResult.lhr;
      console.log('Lighthouse scores:');
      if (categories.performance?.score !== null) console.log(`  Performance: ${Math.round((categories.performance?.score || 0) * 100)}`);
      if (categories.accessibility?.score !== null) console.log(`  Accessibility: ${Math.round((categories.accessibility?.score || 0) * 100)}`);
      if (categories['best-practices']?.score !== null) console.log(`  Best Practices: ${Math.round((categories['best-practices']?.score || 0) * 100)}`);
      if (categories.seo?.score !== null) console.log(`  SEO: ${Math.round((categories.seo?.score || 0) * 100)}`);
    }
    
    return reportHtml;
  } catch (error) {
    console.error('Error collecting Lighthouse report:', error);
    
    // More detailed error logging
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      });
    }
    
    return null;
  } finally {
    // Ensure Chrome is always cleaned up
    if (chrome) {
      try {
        await chrome.kill();
        console.log('Chrome process cleaned up successfully');
      } catch (killError) {
        console.warn('Failed to kill Chrome process:', killError);
      }
    }
  }
}
