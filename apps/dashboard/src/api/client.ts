const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

export const api = {
  listChecks: () => request<{ items: any[] }>("/v1/checks"),
  triggerRun: (checkName: string) =>
    request<{ runId: string; status: string }>("/v1/runs", {
      method: "POST",
      body: JSON.stringify({ checkName, triggeredBy: "API" }),
    }),
  listRunsByCheck: (checkName: string) =>
    request<{ items: any[] }>(
      `/v1/runs?checkName=${encodeURIComponent(checkName)}&limit=20`,
    ),
  listIncidents: () => request<{ items: any[] }>("/v1/incidents"),
  listChannels: () => request<{ items: any[] }>("/v1/channels"),
  listAlertRules: () => request<{ items: any[] }>("/v1/alert-rules"),
  rumSummary: (siteId: string) =>
    request<{ siteId: string; summary: Array<{ metric: string; count: number; avg: number }> }>(
      `/v1/rum/summary?siteId=${encodeURIComponent(siteId)}`,
    ),
  rumSessions: (siteId: string) =>
    request<{ items: any[] }>(`/v1/rum/sessions?siteId=${encodeURIComponent(siteId)}`),
  rumEvents: (siteId: string, limit = 50) =>
    request<{ items: any[] }>(`/v1/rum/events?siteId=${encodeURIComponent(siteId)}&limit=${limit}`),
  health: () => request<{ ok: boolean; watchdog: any }>("/healthz"),
};
