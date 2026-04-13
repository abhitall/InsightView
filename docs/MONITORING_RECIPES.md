# Monitoring recipes for every web application type

Synthetic monitors need different wait strategies and assertions
depending on how the target application delivers content. This
guide is the opinionated playbook for each major app type, using
the same `monitors/*.yaml` format both execution modes consume.

## Single-page applications (React / Vue / Angular / Svelte)

SPAs serve a near-empty HTML shell; all content is rendered by
JavaScript after hydration. A naive `waitUntil: "load"` check will
report TTFB ~200ms but LCP 5+ seconds because the real LCP
candidate doesn't exist yet when the `load` event fires.

```yaml
apiVersion: insightview.io/v1
kind: Check
metadata:
  name: spa-homepage
  tags: [spa, react]
spec:
  type: browser
  schedule: "*/5 * * * *"
  targetUrl: "https://app.example.com/"
  timeoutMs: 60000
  assertions:
    - { type: status, value: passed }
    - { type: body-contains, value: "Welcome back" }
    - { type: max-lcp-ms, value: "4000" }  # SPAs are slower; wider budget
    - { type: max-cls, value: "0.1" }
  steps:
    - name: homepage
      url: "https://app.example.com/"
      waitFor:
        # Wait for the actual LCP candidate element rather than `load`.
        selector: "[data-testid='hero-banner']"
        timeoutMs: 30000
        networkIdle: true  # SPAs fetch data async; wait for idle
  native:
    preCookies:
      # Skip the consent banner so it doesn't become the LCP target.
      - { name: "cookieConsent", value: "accepted" }
    exporters:
      - { type: stdout }
      - { type: github-artifact }
      - { type: pushgateway }
```

### Tips

- **Use `waitFor.selector`**, not `networkIdle` alone — SPAs
  continually fetch background data so `networkidle` can hang.
- **Set `max-lcp-ms` to 4000ms** (twice the static-site budget).
  SPAs are inherently slower to paint the LCP candidate.
- **Use cookies** to pre-consent and pre-authenticate. The
  research plan's #1 source of CLS noise is the consent banner
  appearing mid-load and shifting layout.

## Server-side rendered sites (Next.js / Nuxt / Rails)

SSR apps behave more like traditional pages — full HTML arrives in
the initial response, so LCP is much more reliable. TTFB may be
higher because the server does the rendering work.

```yaml
apiVersion: insightview.io/v1
kind: Check
metadata:
  name: ssr-marketing
spec:
  type: browser
  schedule: "*/5 * * * *"
  targetUrl: "https://marketing.example.com/"
  assertions:
    - { type: status, value: passed }
    - { type: title-contains, value: "Example" }
    - { type: max-lcp-ms, value: "2500" }  # SSR is fast; tight budget
    - { type: max-cls, value: "0.05" }
  steps:
    - name: homepage
      url: "https://marketing.example.com/"
      waitFor:
        networkIdle: false  # `load` is enough for SSR
        timeoutMs: 15000
```

### Tips

- **`waitUntil: "load"`** is fine. SSR gives you the real LCP
  element on the first response.
- **Tighter budgets** are appropriate. 2500ms LCP is the "good"
  threshold and SSR should normally hit it.
- **Track TTFB separately** if the origin is running hot — SSR
  compute time shows up there.

## Static sites (Hugo / Jekyll / Gatsby / Astro)

Pre-rendered HTML from a CDN, lowest TTFB, most predictable Web
Vitals. The budget-setting baseline.

```yaml
apiVersion: insightview.io/v1
kind: Check
metadata:
  name: docs-site
spec:
  type: browser
  schedule: "*/5 * * * *"
  targetUrl: "https://docs.example.com/"
  assertions:
    - { type: status, value: passed }
    - { type: max-lcp-ms, value: "1800" }  # very tight — static is fast
    - { type: max-cls, value: "0.02" }
    - { type: max-duration-ms, value: "3000" }
  steps:
    - name: homepage
      url: "https://docs.example.com/"
      waitFor:
        networkIdle: false
        timeoutMs: 10000
```

### Tips

- **Use static sites as the "good" reference** for your
  assertion thresholds. If your SSR or SPA monitor regresses more
  than the static site under identical CDN conditions, the cause
  is almost certainly in your application code, not the network.

## CDN-fronted sites

Any site behind Cloudflare, Fastly, CloudFront, or Akamai has two
wildly different performance profiles depending on whether the
request hits a cached edge or falls through to origin. The kit's
CDN cache detection captures this automatically via the
`cdnCache` field on every step result — look for the `status`
value (`HIT` / `MISS`) in the exported envelope and filter
dashboards by it.

```yaml
apiVersion: insightview.io/v1
kind: Check
metadata:
  name: cdn-product-detail
spec:
  type: browser
  schedule: "*/10 * * * *"
  targetUrl: "https://shop.example.com/products/featured"
  assertions:
    - { type: status, value: passed }
    - { type: body-contains, value: "Add to cart" }
  steps:
    - name: product
      url: "https://shop.example.com/products/featured"
      waitFor: { networkIdle: false, timeoutMs: 15000 }
  native:
    # Run from two regions so you see edge diversity.
    location: "github-actions-us-east"
    exporters:
      - { type: stdout }
      - { type: pushgateway }
      - { type: github-artifact }
```

### Tips

- **Run the same monitor from multiple regions** (easy with ARC).
  A HIT in eu-west and MISS in ap-southeast tells you the edge
  topology is asymmetric — maybe a new PoP is misconfigured.
- **Segment your PromQL by `cdnCache.status`** to avoid mixing
  edge and origin latency in the same series.

## API endpoints (no browser)

For pure API monitoring skip the browser entirely — the
`oauth-client-credentials` auth strategy fetches a Bearer token
directly and sets it on the context's extra headers.

```yaml
apiVersion: insightview.io/v1
kind: Check
metadata:
  name: api-user-list
spec:
  type: browser  # still uses the Playwright context for assertion machinery
  schedule: "*/1 * * * *"
  targetUrl: "https://api.example.com/v1/users?limit=1"
  timeoutMs: 15000
  assertions:
    - { type: status-code, value: "200" }
    - { type: body-contains, value: "email" }
    - { type: max-duration-ms, value: "500" }
  steps:
    - name: list-users
      url: "https://api.example.com/v1/users?limit=1"
      waitFor: { networkIdle: false, timeoutMs: 5000 }
  native:
    auth:
      strategy: oauth-client-credentials
      config:
        tokenUrl: "https://id.example.com/oauth/token"
        audience: "https://api.example.com"
    exporters: [{ type: stdout }, { type: pushgateway }]
```

## Authenticated app flows

Use `storage-state` auth to pre-bake an authenticated session
offline, then point monitors at post-login URLs.

```yaml
apiVersion: insightview.io/v1
kind: Check
metadata:
  name: dashboard-kpi
spec:
  type: browser
  schedule: "*/10 * * * *"
  targetUrl: "https://app.example.com/dashboard"
  assertions:
    - { type: status, value: passed }
    - { type: body-contains, value: "Monthly revenue" }
  steps:
    - name: dashboard
      url: "https://app.example.com/dashboard"
      waitFor:
        selector: "[data-testid='kpi-revenue']"
        timeoutMs: 20000
  native:
    auth:
      strategy: storage-state
      config:
        env: STORAGE_STATE_JSON  # secret containing the pre-baked state
    exporters: [{ type: stdout }, { type: github-artifact }, { type: pushgateway }]
```

For MFA-protected apps, use `totp`; for enterprise SSO use
`storage-state` with a setup helper that walks through the IdP
redirect chain. For Vault-managed dynamic credentials use
`vault-oidc` — it handles dual-credential rotation automatically.

## Network profiles

| Scenario | Profile |
|---|---|
| Public site, no auth | `direct` |
| Private network via Tailscale | `tailscale` (set up via `tailscale/github-action@v4` before the step) |
| Corporate proxy | `proxy` with `{ server: "http://proxy:3128" }` |
| mTLS client cert | `mtls` with cert+key in base64 env vars |

See the `native-synthetic.yml` example workflow for the Tailscale
setup step; it's commented-in so you can uncomment and drop in
your OAuth credentials.
