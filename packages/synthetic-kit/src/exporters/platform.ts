import type { Exporter } from "./index.js";

/**
 * InsightView Platform exporter. When the optional platform API is
 * running, Actions-native runs can forward their envelopes to it for
 * a central history / dashboard view. This is what bridges the two
 * modes of the platform: you can start with pure GitHub Actions
 * monitoring, then layer the platform on top later without rewriting
 * any of the monitors.
 */
export const platformExporter: Exporter = {
  name: "platform",
  async export(envelope, config) {
    const apiUrl =
      (config.apiUrl as string) ??
      process.env.INSIGHTVIEW_API_URL ??
      process.env.API_URL;
    if (!apiUrl) {
      console.warn("[platform] no apiUrl configured; skipping");
      return;
    }
    const token =
      (config.token as string) ?? process.env.INSIGHTVIEW_API_TOKEN;

    try {
      const res = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/runs/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(envelope),
      });
      if (!res.ok) {
        console.warn(
          `[platform] ingest POST failed: ${res.status} ${res.statusText}`,
        );
      }
    } catch (err) {
      console.warn(`[platform] unreachable: ${(err as Error).message}`);
    }
  },
};
