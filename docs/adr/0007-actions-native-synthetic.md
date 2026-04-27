# ADR 0007 — Actions-native synthetic monitoring mode

**Status**: Accepted
**Date**: Iteration 2

## Context

The platform mode (ADRs 0001–0006) assumes you run a docker-compose
stack or a Kubernetes deployment to host Postgres, Redis, the API,
scheduler, runner, alerting, RUM collector, and dashboard. That's the
right shape for organizations that have already invested in "we run
services" infrastructure — but it's too heavy for teams that just
want "monitor my site from a cron and page me when it breaks."

At the same time, the original v1 of InsightView was a Playwright
GitHub Action — exactly the shape those teams wanted. The platform
evolution risked losing that affordance unless we deliberately
preserved and improved it.

Three problems made the v1 Action flaky enough that it couldn't be
called "production-grade":

1. **Web Vitals don't resolve in headless Playwright.** LCP and CLS
   only finalize when the page becomes hidden, which never happens
   naturally in headless mode. INP needs real user interaction. Any
   naive web-vitals wiring produces empty `{}` for the vitals that
   matter most.
2. **GitHub Actions cron is best-effort.** Runs can be delayed 5–60
   minutes or silently dropped entirely during peak load. Without
   external detection, you'd find out your monitor is down because
   your site is down.
3. **Browser installation is fragile.** `playwright install --with-deps`
   fetches from apt repos that routinely 5xx during CI, wasting 3+
   minutes per run and frequently breaking the entire workflow.

## Decision

Introduce a second execution mode alongside the platform mode,
called **Actions-native**. The platform mode continues unchanged for
teams that want central aggregation. Actions-native runs the exact
same monitors end-to-end inside a single GitHub Actions workflow
using the same YAML format, the same assertion vocabulary, the same
exporters, and the same action.yml — just a different `command`.

The mode is implemented as:

- **`packages/synthetic-kit`** — a reusable, Playwright-based library
  that encapsulates every reliability fix in one place so the
  platform's runner can adopt it in Phase 1 without code duplication.
- **`apps/action-dispatcher`'s `native-run` command** — a thin CLI
  wrapper around the kit that reads monitors YAML, runs them, emits
  envelopes, and exits with an aggregate status code.
- **`.github/workflows/native-synthetic.yml`** — a reference workflow
  showing the three scheduling mechanisms (cron + workflow_dispatch
  + repository_dispatch), the Playwright container image, and the
  heartbeat ping pattern.

### The three reliability fixes

**Web Vitals reliability** (packages/synthetic-kit/src/collectors/webVitals.ts):

- **Bundled IIFE**: at process start we `createRequire.resolve` the
  `web-vitals/dist/web-vitals.iife.js` file and read it into memory.
  The collector injects this via `context.addInitScript({ content })`
  rather than fetching from unpkg. Eliminates both CSP blocks and
  air-gapped CI failures in a single fix.
- **`bypassCSP: true`** on the BrowserContext so any strict
  `script-src` directive the target serves doesn't block our
  `addInitScript` or our `evaluate` calls.
- **`reportAllChanges: true`** on LCP, CLS, and INP so values emit
  continuously instead of waiting for page-hide. The handler stores
  every emitted value on `window.__insightview_vitals`.
- **Force `visibilitychange → hidden`** before collection. We
  `Object.defineProperty` document.visibilityState to `"hidden"` and
  dispatch the event so the web-vitals library finalizes LCP and CLS.
- **Simulate a click** on `body` before the forced visibility change
  so INP has at least one interaction to measure. Failing the click
  is non-fatal.
- **Always emit Navigation Timing as a fallback.** Even when
  web-vitals fails, `navigationTiming.ts` reports TTFB, FCP, DNS,
  TLS, DCL, and load time. "Always report partial metrics rather
  than zero metrics" is the guiding rule.

**Scheduling reliability** (`.github/workflows/native-synthetic.yml`):

- **Triple-trigger**: `schedule` (cron, best-effort),
  `workflow_dispatch` (manual or API), and `repository_dispatch`
  (external scheduler) so cron failures have backup paths.
- **Dead-man's-switch heartbeat**: the `heartbeat_url` input is
  pinged on success and on failure (with a `/fail` suffix).
  Healthchecks.io-compatible, so teams can use the free tier or
  self-host. If the expected ping doesn't arrive within the
  configured grace, the external service pages the on-call.
- **`concurrency`** keyed by workflow name with
  `cancel-in-progress: false` so overlapping schedule + dispatch
  runs queue rather than clobber each other.

**Browser installation reliability**:

- The workflow pins `container: mcr.microsoft.com/playwright:v1.51.0-noble`
  so browsers are pre-installed. The action composite step still
  calls `playwright install` for flexibility, but in the container
  that's a no-op, saving 3+ minutes and eliminating apt flakiness.
- Outside the container, `playwright install` runs with `--with-deps`
  only when the action is running as root (detected via `id -u`).

### Auth strategies (packages/synthetic-kit/src/auth/)

Strategy pattern, one file per strategy:

- **`none`** — no auth (public sites).
- **`storage-state`** — loads a pre-baked Playwright storage state
  JSON (from a secret or a path). Zero credentials leave CI.
- **`form-login`** — username + password from env, fills a login
  form, waits for the success URL glob.
- **`totp`** — wraps form-login with an `otpauth`-generated TOTP
  step for MFA-protected apps.
- **`oauth-client-credentials`** — for API monitoring; skips the
  browser, fetches a Bearer token, sets `Authorization` on every
  request via `setExtraHTTPHeaders`.

Adding a new strategy (SAML, OIDC device code, cookie-jar upload)
is one file plus one registry entry.

### Network profiles (packages/synthetic-kit/src/network/)

- **`direct`** — default.
- **`proxy`** — HTTP/HTTPS/SOCKS proxy via Playwright's
  per-context proxy option.
- **`mtls`** — client certificates loaded from base64-encoded env
  vars at runtime. Uses Playwright's native `clientCertificates`
  support added in v1.46+.
- **`tailscale` / `wireguard`** — identical to `direct` at the
  Playwright layer; the tunnel is established at the workflow level
  via `tailscale/github-action@v4` or similar before this process
  starts.

### Exporters (packages/synthetic-kit/src/exporters/)

Every exporter implements a single `export(envelope, config)` method
and must NOT throw on transient failures — it logs and moves on so
partial results still surface:

- **`stdout`** — pretty-JSON dump into the Actions log. Always enabled.
- **`pushgateway`** — pushes `synthetic_monitoring_*` metrics with the
  same label schema as the legacy v1 exporter, preserving dashboards.
- **`s3`** — uploads the envelope JSON plus screenshots and traces
  to S3 or MinIO, using OIDC credentials when available.
- **`github-artifact`** — copies artifacts into a directory that the
  follow-up `actions/upload-artifact` step picks up. Zero-cloud path.
- **`healthchecks`** — pings the dead-man's-switch. Config supports
  separate success and failure endpoints.
- **`platform`** — POSTs the envelope to the InsightView platform
  REST API. This is the bridge: teams can start in Actions-native
  mode and layer the platform on top later without rewriting monitors.

### Error classification (packages/synthetic-kit/src/errors.ts)

`classifyError` maps any thrown error to one of:

- **`TARGET_DOWN`** — transient network-layer errors (DNS failures,
  connection resets, TLS handshake failures). Safe to retry.
- **`TARGET_ERROR`** — the target responded but returned an unexpected
  status or assertion failure. NOT retryable; alerting should fire.
- **`INFRA_FAILURE`** — our own tooling crashed (Playwright launch
  failed, page crashed, disk full). Retryable; alerts should hint
  "our CI" not "your site".
- **`PARTIAL`** — some metrics collected, some missing. Monitor is
  working but the collection is degraded. Emit metrics, skip alert.

## Consequences

- Teams now have **two equally-supported modes** with a shared YAML
  format, assertion vocabulary, and exporter set. The only
  meaningful difference is where the runner lives.
- The same `monitors/*.yaml` files work in both modes. A team that
  outgrows Actions-native can point the `command: deploy` dispatcher
  at a platform API and their existing monitor definitions are
  accepted unchanged.
- The platform's existing runner (apps/runner/) will be migrated to
  depend on `packages/synthetic-kit` in a follow-up commit so both
  modes share the same web-vitals and error-classification code. For
  now the two runners have some duplicated logic — acceptable for
  this iteration because the synthetic-kit is the clear source of
  truth.
- GitHub Action users can opt in to Actions-native by changing
  `command: legacy-run` to `command: native-run` and writing a
  `monitors/` directory. The legacy-run path still works for
  zero-friction backwards compatibility.

## Alternatives considered

- **Only fix the legacy Playwright fixture path.** Rejected — the
  fixture model ties assertions to Playwright's test runner, which
  is a testing tool not a monitoring tool. Retries, flakiness
  reports, and step timeouts have different semantics in monitoring
  and we kept fighting them.
- **Publish the synthetic-kit as a separate npm package first,
  consume it in v2 later.** Rejected — doubles the distribution
  surface for MVP. A single monorepo with workspace deps is the
  cheaper path; we can always publish later.
- **Use Datadog's SDK / Grafana Faro instead of web-vitals.**
  Rejected — both are excellent but lock us into their ingest
  endpoint. web-vitals is the upstream library they both wrap
  anyway; using it directly keeps the data portable.

## References

- [GitHub Actions scheduled workflow unreliability discussion](https://github.com/orgs/community/discussions/156282)
- [Healthchecks.io GitHub Actions integration](https://healthchecks.io/docs/github_actions/)
- [web-vitals reporting in lab environments issue #180](https://github.com/GoogleChrome/web-vitals/issues/180)
- [Tailscale GitHub Action](https://tailscale.com/kb/1276/tailscale-github-action)
- [Tailscale: private connections for every GitHub Actions runner](https://tailscale.com/blog/private-connections-for-github-actions)
