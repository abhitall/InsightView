import type { AuthStrategy } from "./index.js";

/**
 * Vault OIDC auth. This strategy assumes the workflow has already
 * used `hashicorp/vault-action@v2` to exchange the Actions OIDC
 * token for Vault-issued secrets and exported them as env vars.
 * The strategy layers those env vars on top of one of the other
 * auth strategies (form-login by default) — it's a composition.
 *
 * Expected env vars (populated by vault-action):
 *   VAULT_APP_USERNAME
 *   VAULT_APP_PASSWORD
 *
 * Optionally falls through to a secondary credential set
 * (`VAULT_APP_USERNAME_PREV`, `VAULT_APP_PASSWORD_PREV`) when the
 * primary fails — this implements the "dual-credential rotation"
 * pattern from the research plan, so credential rotation doesn't
 * require monitor downtime.
 *
 * Config:
 *   {
 *     loginUrl: "https://app.example.com/login",
 *     usernameSelector: "#username",
 *     passwordSelector: "#password",
 *     submitSelector: "#submit",
 *     successUrlPattern: "**\/dashboard"
 *   }
 */
export const vaultOidcAuth: AuthStrategy = {
  name: "vault-oidc",
  async apply(context, config) {
    const primary = {
      username: process.env.VAULT_APP_USERNAME,
      password: process.env.VAULT_APP_PASSWORD,
    };
    const secondary = {
      username: process.env.VAULT_APP_USERNAME_PREV,
      password: process.env.VAULT_APP_PASSWORD_PREV,
    };
    const loginUrl = config.loginUrl as string;
    if (!loginUrl) {
      throw new Error("vault-oidc auth requires config.loginUrl");
    }

    if (!primary.username || !primary.password) {
      throw new Error(
        "vault-oidc auth requires VAULT_APP_USERNAME and VAULT_APP_PASSWORD env vars (populated by hashicorp/vault-action)",
      );
    }

    const tryLogin = async (creds: { username?: string; password?: string }) => {
      if (!creds.username || !creds.password) return false;
      const page = await context.newPage();
      try {
        await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.fill(
          (config.usernameSelector as string) ?? "#username",
          creds.username,
        );
        await page.fill(
          (config.passwordSelector as string) ?? "#password",
          creds.password,
        );
        await page.click(
          (config.submitSelector as string) ?? 'button[type="submit"]',
        );
        const success = config.successUrlPattern as string | undefined;
        if (success) {
          await page.waitForURL(success, { timeout: 15000 });
        } else {
          await page.waitForLoadState("networkidle", { timeout: 15000 });
        }
        return true;
      } catch {
        return false;
      } finally {
        await page.close();
      }
    };

    const primaryOk = await tryLogin(primary);
    if (primaryOk) return;
    console.warn("[vault-oidc] primary credentials failed, trying secondary");
    const secondaryOk = await tryLogin(secondary);
    if (secondaryOk) {
      console.warn(
        "[vault-oidc] secondary credentials worked — primary credentials need rotation",
      );
      return;
    }
    throw new Error("vault-oidc auth: both primary and secondary credentials failed");
  },
};
