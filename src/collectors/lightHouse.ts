import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import type { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export async function collectLighthouseReport(page: Page): Promise<string | null> {
  let chrome = null;
  
  try {
    const url = page.url();
    
    if (!url || url === 'about:blank') {
      console.error('Page URL is not valid for Lighthouse analysis');
      return null;
    }

    console.log(`Starting Lighthouse analysis for: ${url}`);

    // Extract cookies from Playwright page to maintain authentication
    const cookies = await page.context().cookies();
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Launch Chrome with optimal configuration for Lighthouse
    chrome = await chromeLauncher.launch({
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
      extraHeaders: cookieString ? { Cookie: cookieString } : {},
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
      if (categories.performance) console.log(`  Performance: ${Math.round(categories.performance.score * 100)}`);
      if (categories.accessibility) console.log(`  Accessibility: ${Math.round(categories.accessibility.score * 100)}`);
      if (categories['best-practices']) console.log(`  Best Practices: ${Math.round(categories['best-practices'].score * 100)}`);
      if (categories.seo) console.log(`  SEO: ${Math.round(categories.seo.score * 100)}`);
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
