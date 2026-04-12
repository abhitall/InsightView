/**
 * Transport strategy: sendBeacon first, fetch(keepalive) fallback. We
 * don't await either — fire-and-forget is the only way to survive the
 * pagehide + visibility change triggers.
 */
export function sendBatch(endpoint: string, payload: unknown): void {
  const body = JSON.stringify(payload);
  const blob = new Blob([body], { type: "application/json" });
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(endpoint, blob);
      if (ok) return;
    }
  } catch {
    /* fall through */
  }
  try {
    void fetch(endpoint, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      credentials: "omit",
      mode: "cors",
    });
  } catch {
    /* swallow */
  }
}
