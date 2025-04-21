import { test } from '../src/monitoring';
import { expect } from '@playwright/test';

test('multi-page performance test', async ({ page, context, monitoring }) => {
  // First page
  await test.step('Navigate to first page', async () => {
    console.log('Navigating to first page');
    await page.goto('/', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Ensure page is fully loaded
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.waitForLoadState('load'),
      page.waitForLoadState('networkidle'),
    ]);
    
    // Additional stabilization wait
    await page.waitForTimeout(5000);
    console.log('First page loaded and stabilized');
  });

  // Second page
  const secondPage = await context.newPage();
  await test.step('Navigate to second page', async () => {
    console.log('Navigating to second page');
    await secondPage.goto('/about', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Ensure page is fully loaded
    await Promise.all([
      secondPage.waitForLoadState('domcontentloaded'),
      secondPage.waitForLoadState('load'),
      secondPage.waitForLoadState('networkidle'),
    ]);
    
    // Additional stabilization wait
    await secondPage.waitForTimeout(5000);
    console.log('Second page loaded and stabilized');
  });

  await test.step('Collect monitoring data from both pages', async () => {
    console.log('Starting to collect web vitals from multiple pages');
    // Force interaction with the page to ensure metrics are collected
    await page.evaluate(() => {
      // Scroll down and up to ensure Cumulative Layout Shift is captured
      window.scrollTo(0, 100);
      setTimeout(() => window.scrollTo(0, 0), 300);
    });
    
    await secondPage.evaluate(() => {
      window.scrollTo(0, 100);
      setTimeout(() => window.scrollTo(0, 0), 300);
    });
    
    // Wait a moment for metrics to be collected
    await page.waitForTimeout(2000);
    
    // Collect metrics from both pages
    await monitoring([page, secondPage]);
    console.log('Monitoring data collection completed');
  });
});

test('homepage performance test', async ({ page, monitoring }) => {
  await test.step('Navigate to homepage', async () => {
    console.log('Navigating to homepage');
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
    
    console.log('Homepage loaded');
  });
  
  await test.step('Wait for page stability', async () => {
    // Longer wait for any dynamic content to settle
    await page.waitForTimeout(5000);
    
    // Force interaction with the page to ensure metrics are collected
    await page.evaluate(() => {
      // Scroll down and up to ensure Cumulative Layout Shift is captured
      window.scrollTo(0, 100);
      setTimeout(() => window.scrollTo(0, 0), 300);
    });
    
    console.log('Page has stabilized');
  });
  
  await test.step('Verify page title', async () => {
    // Increase timeout and add retry ability for title check
    await expect(page, 'Page title should be "Example Domain"').toHaveTitle('Example Domain', {
      timeout: 10000
    });
    console.log('Page title verified');
  });
  
  await test.step('Collect monitoring data', async () => {
    console.log('Starting to collect web vitals');
    await monitoring();
    console.log('Monitoring data collection completed');
  });
});
