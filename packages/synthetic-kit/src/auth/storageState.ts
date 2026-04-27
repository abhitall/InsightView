import { readFileSync } from "node:fs";
import type { AuthStrategy } from "./index.js";

/**
 * storage-state auth: loads a Playwright `storageState` JSON file
 * (produced by a setup project or an offline auth helper). This is
 * the cleanest auth mode for monitoring because no credentials ever
 * leave CI — the whole authenticated session is pre-baked.
 *
 * Config:
 *   { path: "path/to/state.json" }  // file path
 *   { env: "STORAGE_STATE_JSON" }   // env var containing inline JSON
 */
export const storageStateAuth: AuthStrategy = {
  name: "storage-state",
  async apply(context, config) {
    const path = config.path as string | undefined;
    const envVar = config.env as string | undefined;
    let raw: string | undefined;

    if (envVar && process.env[envVar]) {
      raw = process.env[envVar];
    } else if (path) {
      raw = readFileSync(path, "utf8");
    }
    if (!raw) {
      throw new Error(
        "storage-state auth requires either config.path or config.env pointing at storage state JSON",
      );
    }

    const state = JSON.parse(raw) as {
      cookies?: Array<Record<string, unknown>>;
      origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
    };

    if (state.cookies) {
      // @ts-ignore Playwright's cookie type is structural
      await context.addCookies(state.cookies);
    }
    if (state.origins) {
      for (const origin of state.origins) {
        // Can't set localStorage via the API alone; use addInitScript.
        await context.addInitScript(
          (args: { origin: string; entries: Array<{ name: string; value: string }> }) => {
            if (location.origin === args.origin) {
              for (const e of args.entries) {
                try {
                  localStorage.setItem(e.name, e.value);
                } catch {
                  /* ignore */
                }
              }
            }
          },
          { origin: origin.origin, entries: origin.localStorage ?? [] },
        );
      }
    }
  },
};
