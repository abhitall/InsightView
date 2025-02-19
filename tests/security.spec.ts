import { test } from '../src/monitoring';
import { expect } from '@playwright/test';

test('comprehensive authenticated security scan', async ({ page, context, monitoring }) => {
  // First authenticate
  await test.step('Authenticate user', async () => {
    await page.goto('/login');
    await page.fill('#username', process.env.AUTH_USERNAME || '');
    await page.fill('#password', process.env.AUTH_PASSWORD || '');
    await page.click('[type="submit"]');
    await expect(page).toHaveURL('/dashboard');
  });

  // Create array to store pages to scan
  const pagesToScan = [page];

  // Visit and interact with key application flows
  await test.step('Navigate through critical paths', async () => {
    // Profile section
    const profilePage = await context.newPage();
    await profilePage.goto('/profile');
    await profilePage.fill('#email', 'test@example.com');
    await profilePage.click('#save');
    pagesToScan.push(profilePage);

    // Settings section
    const settingsPage = await context.newPage();
    await settingsPage.goto('/settings');
    await settingsPage.selectOption('#timezone', 'UTC');
    await settingsPage.click('#save');
    pagesToScan.push(settingsPage);

    // Form submission section
    const formPage = await context.newPage();
    await formPage.goto('/form');
    await formPage.fill('#field1', 'test data');
    await formPage.fill('#field2', 'more test data');
    await formPage.click('#submit');
    pagesToScan.push(formPage);
  });

  // Perform security scan across all pages
  await test.step('Run security scan', async () => {
    await monitoring({
      pages: pagesToScan,
      securityScan: true,
      isFullScan: process.env.GITHUB_EVENT_NAME === 'schedule'
    });
  });
});