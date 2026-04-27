import type { BrowserContextOptions, LaunchOptions } from "playwright";

/**
 * Network profile strategy. Each profile returns a pair of option
 * objects that the orchestrator passes to `chromium.launch()` and
 * `browser.newContext()` respectively. This gives us a clean seam
 * for direct / proxy / mTLS / Tailscale network topologies without
 * Playwright-specific code leaking into higher layers.
 *
 * Tailscale, WireGuard, and OpenVPN are handled *outside* this file
 * — they are GitHub Action steps (tailscale/github-action@v4, etc.)
 * that set up the runner's network stack before this process starts.
 * From Playwright's point of view they're indistinguishable from
 * "direct" because the tunneled interface is just another IP route.
 */
export interface NetworkProfile {
  readonly name: string;
  launchOptions(config: Record<string, unknown>): LaunchOptions;
  contextOptions(config: Record<string, unknown>): BrowserContextOptions;
}

const direct: NetworkProfile = {
  name: "direct",
  launchOptions: () => ({}),
  contextOptions: () => ({}),
};

const proxy: NetworkProfile = {
  name: "proxy",
  launchOptions: (config) => {
    const server = config.server as string;
    if (!server) throw new Error("proxy profile requires config.server");
    return {};
  },
  contextOptions: (config) => {
    const server = config.server as string;
    if (!server) throw new Error("proxy profile requires config.server");
    const username = config.username as string | undefined;
    const password = config.password as string | undefined;
    return {
      proxy: {
        server,
        username,
        password,
        bypass: (config.bypass as string) ?? "",
      },
    };
  },
};

const mtls: NetworkProfile = {
  name: "mtls",
  launchOptions: () => ({}),
  contextOptions: (config) => {
    const certEnv = (config.certEnv as string) ?? "MTLS_CERT_BASE64";
    const keyEnv = (config.keyEnv as string) ?? "MTLS_KEY_BASE64";
    const origin = config.origin as string;
    if (!origin) throw new Error("mtls profile requires config.origin");
    const certB64 = process.env[certEnv];
    const keyB64 = process.env[keyEnv];
    if (!certB64 || !keyB64) {
      throw new Error(
        `mtls profile missing env: ${certEnv} and/or ${keyEnv} not set`,
      );
    }
    return {
      clientCertificates: [
        {
          origin,
          cert: Buffer.from(certB64, "base64"),
          key: Buffer.from(keyB64, "base64"),
        },
      ],
    };
  },
};

const registry = new Map<string, NetworkProfile>();
registry.set(direct.name, direct);
registry.set(proxy.name, proxy);
registry.set(mtls.name, mtls);
// "tailscale" and "wireguard" are just "direct" from Playwright's PoV —
// the tunnel is set up at the workflow level before this process starts.
registry.set("tailscale", { ...direct, name: "tailscale" });
registry.set("wireguard", { ...direct, name: "wireguard" });

export function networkProfileFor(name: string): NetworkProfile {
  const p = registry.get(name);
  if (!p) throw new Error(`Unknown network profile '${name}'`);
  return p;
}
