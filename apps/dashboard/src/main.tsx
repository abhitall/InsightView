import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ChecksPage } from "./pages/ChecksPage";
import { RunsPage } from "./pages/RunsPage";
import { AlertsPage } from "./pages/AlertsPage";
import { RumPage } from "./pages/RumPage";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/checks" replace />} />
          <Route path="/checks" element={<ChecksPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/rum" element={<RumPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  </React.StrictMode>,
);
