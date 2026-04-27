import * as OTPAuth from "otpauth";
import type { AuthStrategy } from "./index.js";

/**
 * Form login + TOTP (RFC 6238) for MFA-protected sites. Reads the
 * base32 secret from an env var (never hardcode) and generates the
 * current 6-digit code. Config extends form-login with:
 *   {
 *     ...formLogin fields,
 *     totpSelector: "#totp",
 *     totpSubmitSelector: "#totp-submit",
 *     totpSecretEnv: "TOTP_SECRET"
 *   }
 */
export const totpAuth: AuthStrategy = {
  name: "totp",
  async apply(context, config) {
    const loginUrl = config.loginUrl as string;
    const usernameSelector = (config.usernameSelector as string) ?? "#username";
    const passwordSelector = (config.passwordSelector as string) ?? "#password";
    const submitSelector = (config.submitSelector as string) ?? 'button[type="submit"]';
    const totpSelector = (config.totpSelector as string) ?? "#totp";
    const totpSubmitSelector =
      (config.totpSubmitSelector as string) ?? 'button[type="submit"]';
    const successUrlPattern = config.successUrlPattern as string | undefined;
    const usernameEnv = (config.usernameEnv as string) ?? "APP_USERNAME";
    const passwordEnv = (config.passwordEnv as string) ?? "APP_PASSWORD";
    const totpSecretEnv = (config.totpSecretEnv as string) ?? "TOTP_SECRET";

    const username = process.env[usernameEnv];
    const password = process.env[passwordEnv];
    const totpSecret = process.env[totpSecretEnv];
    if (!username || !password || !totpSecret) {
      throw new Error(
        `totp auth missing env: need ${usernameEnv}, ${passwordEnv}, ${totpSecretEnv}`,
      );
    }

    const totp = new OTPAuth.TOTP({
      secret: totpSecret,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });

    const page = await context.newPage();
    try {
      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.fill(usernameSelector, username);
      await page.fill(passwordSelector, password);
      await page.click(submitSelector);
      await page.waitForSelector(totpSelector, { timeout: 30000 });
      await page.fill(totpSelector, totp.generate());
      await page.click(totpSubmitSelector);
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
