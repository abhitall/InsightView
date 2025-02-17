import { test } from '../src/monitoring';
import { expect } from '@playwright/test';

test('multi-page performance test', async ({ page, context, monitoring }) => {
  // First page
  await test.step('Navigate to first page', async () => {
    await page.goto('/', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.waitForLoadState('load'),
      page.waitForLoadState('networkidle'),
    ]);
    await page.waitForTimeout(3000);
  });

  // Second page
  const secondPage = await context.newPage();
  await test.step('Navigate to second page', async () => {
    await secondPage.goto('/about', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    await Promise.all([
      secondPage.waitForLoadState('domcontentloaded'),
      secondPage.waitForLoadState('load'),
      secondPage.waitForLoadState('networkidle'),
    ]);
    await secondPage.waitForTimeout(3000);
  });

  await test.step('Collect monitoring data from both pages', async () => {
    await monitoring([page, secondPage]);
  });
});

test('homepage performance test', async ({ page, monitoring }) => {
  await test.step('Navigate to homepage', async () => {
    // Increase timeout for initial navigation
    await page.goto('/', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Wait for page load
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.waitForLoadState('load'),
      page.waitForLoadState('networkidle'),
    ]);
  });
  
  await test.step('Wait for page stability', async () => {
    // Wait for any dynamic content to settle
    await page.waitForTimeout(3000);
  });
  
  await test.step('Verify page title', async () => {
    // Increase timeout and add retry ability for title check
    await expect(page, 'Page title should be "Example Domain"').toHaveTitle('Example Domain', {
      timeout: 10000
    });
  });
  
  await test.step('Collect monitoring data', async () => {
    await monitoring();
  });
});
