import { useState } from "react";
import { api } from "../api/client";
import { useFetch } from "../hooks/useFetch";

export function RunsPage() {
  const { data: checks } = useFetch(() => api.listChecks(), []);
  const [selected, setSelected] = useState<string>("");
  const effective = selected || checks?.items?.[0]?.name || "";
  const { data: runs, loading, reload } = useFetch(
    () => (effective ? api.listRunsByCheck(effective) : Promise.resolve({ items: [] })),
    [effective],
  );

  const badge = (status: string) => {
    if (status === "PASSED") return "badge badge-pass";
    if (status === "RUNNING" || status === "QUEUED") return "badge badge-info";
    return "badge badge-fail";
  };

  return (
    <>
      <div className="header-row">
        <h2>Runs</h2>
        <div>
          <select
            value={effective}
            onChange={(e) => setSelected(e.target.value)}
            style={{
              padding: "6px 10px",
              background: "var(--panel)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              marginRight: 8,
            }}
          >
            {(checks?.items ?? []).map((c: any) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <button onClick={() => reload()}>Refresh</button>
        </div>
      </div>
      {loading && <div className="muted">Loading…</div>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Run ID</th>
              <th>Status</th>
              <th>Trigger</th>
              <th>Started</th>
              <th>Completed</th>
            </tr>
          </thead>
          <tbody>
            {(runs?.items ?? []).map((r: any) => (
              <tr key={r.id}>
                <td><code style={{ fontSize: 11 }}>{r.id}</code></td>
                <td><span className={badge(r.status)}>{r.status}</span></td>
                <td>{r.triggeredBy}</td>
                <td className="muted">
                  {r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}
                </td>
                <td className="muted">
                  {r.completedAt ? new Date(r.completedAt).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
            {(runs?.items ?? []).length === 0 && !loading && (
              <tr><td colSpan={5} className="muted">No runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
