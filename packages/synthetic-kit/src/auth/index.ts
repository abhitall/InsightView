import type { BrowserContext } from "playwright";
import { noneAuth } from "./none.js";
import { storageStateAuth } from "./storageState.js";
import { formLoginAuth } from "./formLogin.js";
import { totpAuth } from "./totp.js";
import { oauthClientCredsAuth } from "./oauthClientCreds.js";

/**
 * Auth strategy interface. Each strategy mutates a freshly created
 * BrowserContext (setting cookies, storage, extra headers, or walking
 * through a login flow) so that subsequent page.goto calls are
 * already authenticated.
 *
 * Strategies are registered by name in the factory below; adding a
 * new one (SAML, OIDC device code, mTLS-in-context) is a single map
 * entry.
 */
export interface AuthStrategy {
  readonly name: string;
  apply(
    context: BrowserContext,
    config: Record<string, unknown>,
  ): Promise<void>;
}

const registry = new Map<string, AuthStrategy>();

export function registerAuthStrategy(strategy: AuthStrategy): void {
  registry.set(strategy.name, strategy);
}

export function authStrategyFor(name: string): AuthStrategy {
  const s = registry.get(name);
  if (!s) {
    throw new Error(`Unknown auth strategy '${name}'. Registered: ${[...registry.keys()].join(", ")}`);
  }
  return s;
}

// Built-in strategies.
registerAuthStrategy(noneAuth);
registerAuthStrategy(storageStateAuth);
registerAuthStrategy(formLoginAuth);
registerAuthStrategy(totpAuth);
registerAuthStrategy(oauthClientCredsAuth);
