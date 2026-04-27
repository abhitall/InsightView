import { useState } from "react";
import { api } from "../api/client";
import { useFetch } from "../hooks/useFetch";

export function RumPage() {
  const [siteId, setSiteId] = useState("test-site-home");
  const { data: summary, reload: reloadSummary, loading: loadingSummary } = useFetch(
    () => api.rumSummary(siteId),
    [siteId],
  );
  const { data: sessions, reload: reloadSessions } = useFetch(
    () => api.rumSessions(siteId),
    [siteId],
  );
  const { data: events, reload: reloadEvents } = useFetch(
    () => api.rumEvents(siteId, 50),
    [siteId],
  );

  const reloadAll = () => {
    reloadSummary();
    reloadSessions();
    reloadEvents();
  };

  return (
    <>
      <div className="header-row">
        <h2>Real User Monitoring</h2>
        <div>
          <input
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            placeholder="siteId"
            style={{
              padding: "6px 10px",
              background: "var(--panel)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              marginRight: 8,
            }}
          />
          <button onClick={reloadAll}>Refresh</button>
        </div>
      </div>

      <div className="card">
        <h3>Web Vitals (last 24h)</h3>
        {loadingSummary && <div className="muted">Loading…</div>}
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Count</th>
              <th>Avg</th>
            </tr>
          </thead>
          <tbody>
            {(summary?.summary ?? []).map((s) => (
              <tr key={s.metric}>
                <td>{s.metric}</td>
                <td>{s.count}</td>
                <td>{s.avg.toFixed(1)}</td>
              </tr>
            ))}
            {(summary?.summary ?? []).length === 0 && (
              <tr><td colSpan={3} className="muted">No data yet. Load the test-site to emit events.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Sessions ({sessions?.items?.length ?? 0})</h3>
        <table>
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Device</th>
              <th>Pages</th>
              <th>First seen</th>
            </tr>
          </thead>
          <tbody>
            {(sessions?.items ?? []).slice(0, 15).map((s: any) => (
              <tr key={s.id}>
                <td><code style={{ fontSize: 11 }}>{s.id.slice(0, 8)}…</code></td>
                <td>{s.deviceCategory}</td>
                <td>{s.pageCount}</td>
                <td className="muted">{new Date(s.startedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Recent events ({events?.items?.length ?? 0})</h3>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Name</th>
              <th>Value</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {(events?.items ?? []).slice(0, 25).map((e: any) => (
              <tr key={e.id}>
                <td><span className="badge badge-info">{e.type}</span></td>
                <td>{e.name}</td>
                <td>{typeof e.value === "number" ? e.value.toFixed(1) : "—"}</td>
                <td className="muted">{new Date(e.receivedAt).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
