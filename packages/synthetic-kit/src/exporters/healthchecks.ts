import type { Exporter } from "./index.js";

/**
 * Healthchecks.io (or self-hosted healthchecks) dead-man's-switch
 * exporter. Pings the provided URL with a short status suffix so
 * you can distinguish "no ping at all" (broken CI) from
 * "ping with /fail" (monitor saw a failure).
 *
 * Config:
 *   {
 *     url: "https://hc-ping.com/<uuid>",
 *     pingOnFailure: true  // default false — most teams only want success pings
 *   }
 */
export const healthchecksExporter: Exporter = {
  name: "healthchecks",
  async export(envelope, config) {
    const url =
      (config.url as string) ?? process.env.INSIGHTVIEW_HEARTBEAT_URL;
    if (!url) return;

    const pingOnFailure = Boolean(config.pingOnFailure);
    const passed = envelope.status === "PASSED";
    if (!passed && !pingOnFailure) return;

    const target = passed ? url : `${url.replace(/\/$/, "")}/fail`;
    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monitor: envelope.monitor,
          runId: envelope.runId,
          status: envelope.status,
          durationMs: envelope.durationMs,
        }),
      });
      if (!res.ok) {
        console.warn(
          `[healthchecks] ping failed: ${res.status} ${res.statusText}`,
        );
      }
    } catch (err) {
      console.warn(`[healthchecks] unreachable: ${(err as Error).message}`);
    }
  },
};
