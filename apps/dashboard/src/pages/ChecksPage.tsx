import { useState } from "react";
import { api } from "../api/client";
import { useFetch } from "../hooks/useFetch";

export function ChecksPage() {
  const { data, error, loading, reload } = useFetch(() => api.listChecks(), []);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  const trigger = async (name: string) => {
    setTriggering(name);
    try {
      const res = await api.triggerRun(name);
      setLastRunId(res.runId);
      setTimeout(() => reload(), 500);
    } catch (e) {
      alert(`Trigger failed: ${(e as Error).message}`);
    } finally {
      setTriggering(null);
    }
  };

  return (
    <>
      <div className="header-row">
        <h2>Checks</h2>
        <button onClick={() => reload()}>Refresh</button>
      </div>
      {loading && <div className="muted">Loading…</div>}
      {error && <div className="error">Error: {error.message}</div>}
      {lastRunId && (
        <div className="card" style={{ fontSize: 13 }}>
          Triggered run: <code>{lastRunId}</code>
        </div>
      )}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Schedule</th>
              <th>Target</th>
              <th>Enabled</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((c: any) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.type}</td>
                <td><code>{c.schedule}</code></td>
                <td className="muted">{c.targetUrl}</td>
                <td>
                  <span className={c.enabled ? "badge badge-pass" : "badge badge-warn"}>
                    {c.enabled ? "enabled" : "disabled"}
                  </span>
                </td>
                <td>
                  <button
                    disabled={triggering === c.name}
                    onClick={() => trigger(c.name)}
                  >
                    {triggering === c.name ? "Running…" : "Run now"}
                  </button>
                </td>
              </tr>
            ))}
            {(data?.items ?? []).length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="muted">No checks yet. Deploy monitors via the API or GitHub Action.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
