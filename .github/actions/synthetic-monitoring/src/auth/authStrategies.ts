import { Page } from '@playwright/test';

export interface AuthStrategy {
  authenticate(page: Page): Promise<void>;
}

export class FormAuthStrategy implements AuthStrategy {
  async authenticate(page: Page): Promise<void> {
    const selectors = JSON.parse(process.env.AUTH_SELECTORS || '{}');
    await page.goto(process.env.AUTH_URL || '');
    await page.fill(selectors.username || '#username', process.env.AUTH_USERNAME || '');
    await page.fill(selectors.password || '#password', process.env.AUTH_PASSWORD || '');
    await page.click(selectors.submit || 'button[type="submit"]');
    await page.waitForURL(selectors.successUrl || '**/*');
  }
}

export class TokenAuthStrategy implements AuthStrategy {
  async authenticate(page: Page): Promise<void> {
    await page.goto(process.env.AUTH_URL || '');
    await page.evaluate((token) => {
      localStorage.setItem('auth_token', token);
    }, process.env.AUTH_TOKEN);
  }
}

export class OAuthStrategy implements AuthStrategy {
  async authenticate(page: Page): Promise<void> {
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
  }
}

export class BasicAuthStrategy implements AuthStrategy {
  async authenticate(page: Page): Promise<void> {
    await page.setExtraHTTPHeaders({
      'Authorization': `Basic ${Buffer.from(`${process.env.AUTH_USERNAME}:${process.env.AUTH_PASSWORD}`).toString('base64')}`,
    });
  }
}