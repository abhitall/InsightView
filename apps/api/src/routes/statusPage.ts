import type { FastifyInstance } from "fastify";
import { listChecks, listRunsByCheck } from "@insightview/db";
import { defaultTenant } from "@insightview/core";

/**
 * Public status pages. Renders a minimal HTML / JSON view of the
 * current monitor state for unauthenticated users (the tenant
 * plugin explicitly allow-lists /v1/status/* URLs).
 *
 * Two outputs:
 *   GET /v1/status.json — JSON payload
 *   GET /v1/status/     — HTML page (Accept: text/html)
 *
 * The renderer is deliberately dependency-free — no React, no
 * templating library, just a single template literal — so the
 * status page stays fast and deployable even if the dashboard
 * isn't running.
 */

interface StatusMonitor {
  name: string;
  enabled: boolean;
  latestStatus: string;
  lastRunAt: string | null;
  tags: string[];
}

async function buildStatus(): Promise<StatusMonitor[]> {
  const ctx = defaultTenant("public");
  const checks = await listChecks(ctx);
  const out: StatusMonitor[] = [];
  for (const check of checks) {
    const runs = await listRunsByCheck(ctx, check.id, 1);
    const latest = runs[0];
    out.push({
      name: check.name,
      enabled: check.enabled,
      latestStatus: latest?.status ?? "NEVER_RUN",
      lastRunAt: latest?.completedAt?.toISOString() ?? null,
      tags: check.tags,
    });
  }
  return out;
}

export async function registerStatusPageRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/v1/status.json", async () => {
    const monitors = await buildStatus();
    const allOk = monitors.every(
      (m) => !m.enabled || m.latestStatus === "PASSED",
    );
    return {
      ok: allOk,
      updatedAt: new Date().toISOString(),
      monitors,
    };
  });

  app.get<{ Params: { path?: string } }>(
    "/v1/status/*",
    async (_req, reply) => {
      const monitors = await buildStatus();
      const allOk = monitors.every(
        (m) => !m.enabled || m.latestStatus === "PASSED",
      );
      reply.header("Content-Type", "text/html; charset=utf-8");
      return renderHtml(monitors, allOk);
    },
  );

  // Alias so /v1/status/ also works
  app.get("/v1/status/", async (_req, reply) => {
    const monitors = await buildStatus();
    const allOk = monitors.every(
      (m) => !m.enabled || m.latestStatus === "PASSED",
    );
    reply.header("Content-Type", "text/html; charset=utf-8");
    return renderHtml(monitors, allOk);
  });
}

function renderHtml(monitors: StatusMonitor[], ok: boolean): string {
  const rows = monitors
    .map((m) => {
      const cls =
        m.latestStatus === "PASSED"
          ? "ok"
          : m.latestStatus === "NEVER_RUN"
            ? "dim"
            : "fail";
      const last = m.lastRunAt
        ? new Date(m.lastRunAt).toLocaleString()
        : "—";
      return `<tr class="${cls}"><td>${escapeHtml(m.name)}</td><td>${m.enabled ? "enabled" : "disabled"}</td><td>${m.latestStatus}</td><td>${last}</td></tr>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<title>InsightView Status</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; background: #f7fafc; color: #1b2432; margin: 0; }
  header { padding: 32px; background: ${ok ? "#10b981" : "#ef4444"}; color: white; text-align: center; }
  header h1 { margin: 0 0 8px 0; }
  header p { margin: 0; opacity: 0.9; }
  main { max-width: 960px; margin: 24px auto; padding: 0 16px; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
  th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #edf2f7; }
  th { background: #edf2f7; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #718096; }
  tr.ok td { color: #065f46; }
  tr.fail td { color: #991b1b; }
  tr.dim td { color: #718096; font-style: italic; }
  footer { text-align: center; padding: 24px; color: #718096; font-size: 12px; }
</style>
</head><body>
<header>
  <h1>${ok ? "All systems operational" : "Issues detected"}</h1>
  <p>${new Date().toLocaleString()}</p>
</header>
<main>
  <table>
    <thead><tr><th>Monitor</th><th>Enabled</th><th>Latest</th><th>Last run</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="dim">No monitors configured</td></tr>'}</tbody>
  </table>
</main>
<footer>Powered by InsightView — refresh or subscribe to <a href="/v1/status.json">/v1/status.json</a></footer>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
