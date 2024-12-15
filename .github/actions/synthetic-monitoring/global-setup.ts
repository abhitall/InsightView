import { chromium } from '@playwright/test';

async function globalSetup() {
  const authType = process.env.AUTH_TYPE;
  if (!authType) return;

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    switch (authType.toLowerCase()) {
      case 'form': {
        const selectors = JSON.parse(process.env.AUTH_SELECTORS || '{}');
        await page.goto(process.env.AUTH_URL || '');
        await page.fill(selectors.username || '#username', process.env.AUTH_USERNAME || '');
        await page.fill(selectors.password || '#password', process.env.AUTH_PASSWORD || '');
        await page.click(selectors.submit || 'button[type="submit"]');
        await page.waitForURL(selectors.successUrl || '**/*');
        break;
      }
      case 'token': {
        await page.goto(process.env.AUTH_URL || '');
        await page.evaluate((token) => {
          localStorage.setItem('auth_token', token);
        }, process.env.AUTH_TOKEN);
        break;
      }
      case 'oauth': {
        // Implement OAuth flow using client credentials
        const tokenResponse = await fetch(process.env.AUTH_URL || '', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: process.env.AUTH_CLIENT_ID || '',
            client_secret: process.env.AUTH_CLIENT_SECRET || '',
            scope: process.env.AUTH_SCOPE || '',
          }),
        });
        const { access_token } = await tokenResponse.json();
        await page.evaluate((token) => {
          localStorage.setItem('oauth_token', token);
        }, access_token);
        break;
      }
      case 'basic': {
        // Set up basic auth headers
        await page.setExtraHTTPHeaders({
          'Authorization': `Basic ${Buffer.from(`${process.env.AUTH_USERNAME}:${process.env.AUTH_PASSWORD}`).toString('base64')}`,
        });
        break;
      }
    }

    // Save authentication state
    await page.context().storageState({ path: 'auth.json' });
  } finally {
    await browser.close();
  }
}

export default globalSetup;