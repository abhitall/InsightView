import { test } from '../src/monitoring';
import { expect } from '@playwright/test';

test('homepage performance test', async ({ page, monitoring }) => {
  await test.step('Navigate to homepage', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });
  
  await test.step('Verify page title', async () => {
    await expect(page).toHaveTitle(/Vite \+ React/);
  });
  
  await test.step('Collect monitoring data', async () => {
    await monitoring();
  });
});