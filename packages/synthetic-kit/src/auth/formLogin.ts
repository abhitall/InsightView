import type { AuthStrategy } from "./index.js";

/**
 * Simple username/password form login. Config:
 *   {
 *     loginUrl: "https://app.example.com/login",
 *     usernameSelector: "#username",
 *     passwordSelector: "#password",
 *     submitSelector: "#submit",
 *     successUrlPattern: "**\/dashboard",  // optional wait-for-URL glob
 *     usernameEnv: "APP_USERNAME",
 *     passwordEnv: "APP_PASSWORD"
 *   }
 */
export const formLoginAuth: AuthStrategy = {
  name: "form-login",
  async apply(context, config) {
    const loginUrl = config.loginUrl as string;
    const usernameSelector = (config.usernameSelector as string) ?? "#username";
    const passwordSelector = (config.passwordSelector as string) ?? "#password";
    const submitSelector = (config.submitSelector as string) ?? 'button[type="submit"]';
    const successUrlPattern = config.successUrlPattern as string | undefined;
    const usernameEnv = (config.usernameEnv as string) ?? "APP_USERNAME";
    const passwordEnv = (config.passwordEnv as string) ?? "APP_PASSWORD";

    const username = process.env[usernameEnv];
    const password = process.env[passwordEnv];
    if (!username || !password) {
      throw new Error(
        `form-login auth missing env: ${usernameEnv} and/or ${passwordEnv} not set`,
      );
    }

    const page = await context.newPage();
    try {
      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.fill(usernameSelector, username);
      await page.fill(passwordSelector, password);
      await page.click(submitSelector);
      if (successUrlPattern) {
        await page.waitForURL(successUrlPattern, { timeout: 30000 });
      } else {
        await page.waitForLoadState("networkidle", { timeout: 30000 });
      }
    } finally {
      await page.close();
    }
  },
};
