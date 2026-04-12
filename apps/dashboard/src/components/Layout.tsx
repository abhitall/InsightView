import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

export function Layout({ children }: PropsWithChildren) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>InsightView</h1>
        <nav>
          <NavLink to="/checks">Checks</NavLink>
          <NavLink to="/runs">Runs</NavLink>
          <NavLink to="/alerts">Alerts</NavLink>
          <NavLink to="/rum">RUM</NavLink>
        </nav>
        <div style={{ marginTop: "auto", fontSize: 12, color: "var(--muted)" }}>
          <div>v0.1.0</div>
          <div>Platform MVP</div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
