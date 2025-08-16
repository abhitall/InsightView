import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import type { Page } from '@playwright/test';

export async function collectLighthouseReport(page: Page): Promise<string | null> {
  try {
    const chrome = await chromeLauncher.launch({
      chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
    });
    const options = {
      port: chrome.port,
      output: 'html',
      logLevel: 'info',
    };
    // @ts-ignore
    const runnerResult = await lighthouse(page.url(), options);

    if (!runnerResult) {
      console.error('Lighthouse returned no result');
      await chrome.kill();
      return null;
    }

    // `.report` is the HTML report as a string
    const reportHtml = runnerResult.report;
    if (typeof reportHtml !== 'string') {
      console.error('Lighthouse report is not a string');
      await chrome.kill();
      return null;
    }
    
    await chrome.kill();
    return reportHtml;
  } catch (error) {
    console.error('Error collecting Lighthouse report:', error);
    return null;
  }
}
