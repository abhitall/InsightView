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
    await page.goto('/');
    
    // Wait for all network activity to settle
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.waitForLoadState('load'),
      page.waitForLoadState('networkidle'),
    ]);
    
    // Additional wait for page stability
    await page.waitForTimeout(5000);
    
    // Force some interactions to ensure metrics are captured
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
      setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 1000);
    });
  });
  
  await test.step('Verify page title', async () => {
    await expect(page).toHaveTitle(/Expected Title/);
  });
  
  await test.step('Collect monitoring data for homepage', async () => {
    console.log('Collecting monitoring data for homepage');
    await monitoring();
  });

  // Navigate to another page to test resource collection
  await test.step('Navigate to second page', async () => {
    console.log('Navigating to second page');
    await page.click('a:first-child'); // Click first link, adjust selector as needed
    
    // Wait for all network activity to settle
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.waitForLoadState('load'),
      page.waitForLoadState('networkidle'),
    ]);
    
    // Additional wait for page stability
    await page.waitForTimeout(5000);
    
    // Force some interactions
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
      setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 1000);
    });
  });

  await test.step('Collect monitoring data for second page', async () => {
    console.log('Collecting monitoring data for second page');
    await monitoring();
  });
});

test('api endpoints performance test', async ({ page, monitoring }) => {
  await test.step('Test API endpoints', async () => {
    console.log('Testing API endpoints');
    
    // Make multiple API calls to test resource timing
    const endpoints = ['/api/users', '/api/products', '/api/orders'];
    
    for (const endpoint of endpoints) {
      console.log(`Testing endpoint: ${endpoint}`);
      const response = await page.evaluate(async (url) => {
        const start = performance.now();
        const response = await fetch(url);
        const data = await response.json();
        const end = performance.now();
        return { status: response.status, duration: end - start };
      }, endpoint);
      
      console.log(`Endpoint ${endpoint} response:`, response);
      
      // Wait briefly between requests
      await page.waitForTimeout(1000);
    }
  });

  await test.step('Collect monitoring data for API endpoints', async () => {
    console.log('Collecting monitoring data for API endpoints');
    await monitoring();
  });
});
