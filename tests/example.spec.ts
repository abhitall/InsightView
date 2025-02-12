import { test } from '../src/monitoring';
import { expect } from '@playwright/test';

test('homepage performance test', async ({ page, monitoring }) => {
  await test.step('Navigate to homepage', async () => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // Ensure the page is fully loaded and interactive
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('load');
  });
  
  await test.step('Wait for page stability', async () => {
    // Wait additional time for JS execution and animations
    await page.waitForTimeout(2000);
  });
  
  await test.step('Verify page title', async () => {
    await expect(page).toHaveTitle('Example Domain');
  });
  
  await test.step('Collect monitoring data', async () => {
    await monitoring();
  });
});
