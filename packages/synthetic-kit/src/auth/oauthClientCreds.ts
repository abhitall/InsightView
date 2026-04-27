import type { AuthStrategy } from "./index.js";

/**
 * OAuth 2.0 client credentials grant. Appropriate for monitoring
 * API endpoints that don't need a browser session — we fetch a
 * Bearer token from the identity provider and set it as an extra
 * header on every request the context makes.
 *
 * Config:
 *   {
 *     tokenUrl: "https://id.example.com/oauth/token",
 *     clientIdEnv: "OAUTH_CLIENT_ID",
 *     clientSecretEnv: "OAUTH_CLIENT_SECRET",
 *     scope: "read:metrics",  // optional
 *     audience: "https://api.example.com"  // optional
 *   }
 */
export const oauthClientCredsAuth: AuthStrategy = {
  name: "oauth-client-credentials",
  async apply(context, config) {
    const tokenUrl = config.tokenUrl as string;
    const clientIdEnv = (config.clientIdEnv as string) ?? "OAUTH_CLIENT_ID";
    const clientSecretEnv =
      (config.clientSecretEnv as string) ?? "OAUTH_CLIENT_SECRET";
    const scope = config.scope as string | undefined;
    const audience = config.audience as string | undefined;

    const clientId = process.env[clientIdEnv];
    const clientSecret = process.env[clientSecretEnv];
    if (!clientId || !clientSecret) {
      throw new Error(
        `oauth-client-credentials missing env: ${clientIdEnv}, ${clientSecretEnv}`,
      );
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (scope) body.set("scope", scope);
    if (audience) body.set("audience", audience);

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(
        `oauth-client-credentials token request failed: ${res.status} ${await res
          .text()
          .catch(() => "")}`,
      );
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new Error("oauth-client-credentials: token endpoint did not return access_token");
    }
    await context.setExtraHTTPHeaders({
      Authorization: `Bearer ${data.access_token}`,
    });
  },
};
