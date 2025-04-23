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
    
    // Wait for page to be fully interactive
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.waitForLoadState('load'),
    ]);
    
    // Force some interactions
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    
    // Brief wait for metrics to stabilize
    await page.waitForTimeout(2000);
    console.log('First page loaded and stabilized');
  });

  // Collect metrics for first page
  await test.step('Collect first page metrics', async () => {
    console.log('Collecting metrics for first page');
    await monitoring();
  });

  // Second page
  await test.step('Navigate to second page', async () => {
    console.log('Navigating to second page');
    await page.goto('/about', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Wait for page to be fully interactive
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.waitForLoadState('load'),
    ]);
    
    // Force some interactions
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    
    // Brief wait for metrics to stabilize
    await page.waitForTimeout(2000);
    console.log('Second page loaded and stabilized');
  });

  // Collect metrics for second page
  await test.step('Collect second page metrics', async () => {
    console.log('Collecting metrics for second page');
    await monitoring();
  });
});

test('homepage performance test', async ({ page, monitoring }) => {
  await test.step('Navigate to homepage', async () => {
    console.log('Navigating to homepage');
    await page.goto('/', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    // Wait for page to be fully interactive
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {
      console.warn('Load state not reached, continuing with current state');
    });
    
    // Additional wait for page stability
    await page.waitForTimeout(5000);
    
    // Force some interactions to ensure metrics are captured
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
      setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 1000);
    });
  });
  
  await test.step('Verify page title', async () => {
    await expect(page).toHaveTitle(/Example Domain/);
  });
  
  await test.step('Collect monitoring data for homepage', async () => {
    console.log('Collecting monitoring data for homepage');
    await monitoring();
  });

  // Navigate to another page to test resource collection
  await test.step('Navigate to second page', async () => {
    console.log('Navigating to second page');
    await page.click('a:first-child', { timeout: 10000 }); // Click first link, adjust selector as needed
    
    // Wait for navigation to start
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {
      console.warn('DOMContentLoaded not reached, continuing with current state');
    });
    
    // Wait for load state with a shorter timeout
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {
      console.warn('Load state not reached, continuing with current state');
    });
    
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
    
    // Make API calls sequentially to avoid interference
    const endpoints = ['/api/users', '/api/products', '/api/orders'];
    
    for (const endpoint of endpoints) {
      console.log(`Testing endpoint: ${endpoint}`);
      
      // Navigate to a blank page before making API calls
      await page.goto('about:blank');
      
      const response = await page.evaluate(async (url) => {
        const start = performance.now();
        try {
          const response = await fetch(url);
          const data = await response.json();
          const end = performance.now();
          return { 
            status: response.status, 
            duration: end - start,
            success: true 
          };
        } catch (e) {
          return { 
            status: 0, 
            duration: performance.now() - start,
            success: false,
            error: e.message
          };
        }
      }, endpoint);
      
      console.log(`Endpoint ${endpoint} response:`, response);
      
      // Collect metrics after each API call
      await monitoring();
      
      // Brief wait between requests
      await page.waitForTimeout(1000);
    }
  });
});
