import { test } from '../src/monitoring';
import { expect } from '@playwright/test';

test('monitor authenticated dashboard and run security scan', async ({ page, monitoring }) => {
  // Log in first
  await page.goto('/login');
  await page.fill('#username', process.env.AUTH_USERNAME || '');
  await page.fill('#password', process.env.AUTH_PASSWORD || '');
  await page.click('button[type="submit"]');
  
  // Wait for successful login and navigation
  await expect(page).toHaveURL('/dashboard');

  // Monitor dashboard performance
  await monitoring();
});

test('security scan of user profile section', async ({ page, monitoring }) => {
  // Log in and navigate to profile
  await page.goto('/login');
  await page.fill('#username', process.env.AUTH_USERNAME || '');
  await page.fill('#password', process.env.AUTH_PASSWORD || '');
  await page.click('button[type="submit"]');
  
  // Navigate to profile section
  await page.click('a[href="/profile"]');
  await expect(page).toHaveURL('/profile');

  // Run security scan on the profile section
  await monitoring({ 
    securityScan: true
  });
});

test('full security scan of admin panel', async ({ page, monitoring }) => {
  // Log in as admin
  await page.goto('/admin/login');
  await page.fill('#username', process.env.ADMIN_USERNAME || '');
  await page.fill('#password', process.env.ADMIN_PASSWORD || '');
  await page.click('button[type="submit"]');
  
  // Navigate to admin dashboard
  await expect(page).toHaveURL('/admin/dashboard');

  // Run full security scan of admin section
  await monitoring({ 
    securityScan: true,
    isFullScan: true
  });
});