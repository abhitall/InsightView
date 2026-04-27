import { api } from "../api/client";
import { useFetch } from "../hooks/useFetch";

export function AlertsPage() {
  const { data: rules } = useFetch(() => api.listAlertRules(), []);
  const { data: incidents, reload } = useFetch(() => api.listIncidents(), []);

  const severityClass = (sev: string) => {
    if (sev === "CRITICAL") return "badge badge-fail";
    if (sev === "WARNING") return "badge badge-warn";
    return "badge badge-info";
  };

  return (
    <>
      <div className="header-row">
        <h2>Alerts</h2>
        <button onClick={() => reload()}>Refresh</button>
      </div>

      <div className="card">
        <h3>Rules</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Strategy</th>
              <th>Severity</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {(rules?.items ?? []).map((r: any) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.strategy}</td>
                <td><span className={severityClass(r.severity)}>{r.severity}</span></td>
                <td>{r.enabled ? "yes" : "no"}</td>
              </tr>
            ))}
            {(rules?.items ?? []).length === 0 && (
              <tr><td colSpan={4} className="muted">No rules configured.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Incidents</h3>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Opened</th>
              <th>Resolved</th>
            </tr>
          </thead>
          <tbody>
            {(incidents?.items ?? []).map((i: any) => (
              <tr key={i.id}>
                <td><code style={{ fontSize: 11 }}>{i.id}</code></td>
                <td><span className={severityClass(i.severity)}>{i.severity}</span></td>
                <td>{i.status}</td>
                <td className="muted">{new Date(i.openedAt).toLocaleString()}</td>
                <td className="muted">{i.resolvedAt ? new Date(i.resolvedAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {(incidents?.items ?? []).length === 0 && (
              <tr><td colSpan={5} className="muted">No incidents.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
