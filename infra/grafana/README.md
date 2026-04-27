# InsightView Grafana dashboards

Two dashboards ship with the platform:

- **`synthetic.json`** — uses a Prometheus datasource scraping
  the Pushgateway populated by the synthetic-kit's `pushgateway`
  exporter. Shows uptime, run duration, Web Vitals, and assertion
  outcomes per monitor + location.

- **`rum.json`** — uses an "InsightViewApi" datasource (the
  [JSON API](https://grafana.com/grafana/plugins/simpod-json-datasource/)
  or similar) pointed at `/v1/rum/*` endpoints. Shows sessions,
  RUM Web Vitals, recent errors, and — crucially — a **synthetic
  vs. RUM overlay panel** that directly compares the two sources
  on the same metric name + label schema. A widening gap signals
  a CDN or geographic regression.

## Import

Via the Grafana UI:
1. Dashboards → New → Import
2. Upload `synthetic.json` or `rum.json`
3. Select the Prometheus datasource when prompted

Or via provisioning: drop both files under your Grafana container's
`/etc/grafana/provisioning/dashboards/` directory and restart.

## Label schema for unified synthetic + RUM

Both modes emit their web-vitals metrics with the same name
(`synthetic_monitoring_web_vitals` / `rum_web_vitals`) and the
same label taxonomy — `monitor`, `site`, `metric`, `location` —
so a single PromQL query can correlate them:

```promql
synthetic_monitoring_web_vitals{metric="LCP",monitor=~"$site.*"}
  unless on() synthetic_monitoring_status == 0
```

The `platform` exporter on the synthetic-kit POSTs to
`/v1/runs/ingest`; the rum-collector emits to the same API. The
unified schema means a new RUM event type or metric auto-surfaces
in both dashboards without any ETL.
