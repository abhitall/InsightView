/**
 * Transport strategy: sendBeacon first, fetch(keepalive) fallback. We
 * don't await either — fire-and-forget is the only way to survive the
 * pagehide + visibility change triggers.
 *
 * `navigator.sendBeacon` can ONLY send a CORS-safelisted Content-Type
 * (text/plain, application/x-www-form-urlencoded, multipart/form-data).
 * Wrapping a JSON body in a Blob with `type: "application/json"`
 * silently fails cross-origin because the browser tries to send a
 * preflight, but sendBeacon never sends preflights — the request is
 * dropped with no error, and `sendBeacon` returns `true` regardless.
 *
 * We therefore send the JSON payload as a `text/plain` Blob; the
 * receiver parses it from the raw body either way.
 */
export function sendBatch(endpoint: string, payload: unknown): void {
  const body = JSON.stringify(payload);
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
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
