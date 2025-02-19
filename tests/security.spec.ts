import { test } from '../src/monitoring';
import { expect } from '@playwright/test';

test('security and performance test', async ({ page, monitoring }) => {
  await test.step('Navigate to target page', async () => {
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
  
  await test.step('Verify page load', async () => {
    // Wait for any dynamic content to settle
    await page.waitForTimeout(3000);
    
    // Basic assertions to ensure page loaded correctly
    await expect(page).toHaveTitle(/.+/);
    await expect(page.locator('body')).not.toBeEmpty();
  });
  
  await test.step('Run security scan and collect metrics', async () => {
    // This will trigger both performance metrics collection and ZAP scan
    await monitoring();
  });
});