# ADR 0009 — Session replay, source maps, and RUM framework wrappers

**Status**: Accepted
**Date**: Iteration 3

## Context

ADRs 0004 (RUM SDK design) and the original roadmap deferred three
RUM depth features to Phase 3/4:

1. Session replay via rrweb so teams can *see* the user's session
   around an error, not just the error itself.
2. Source map upload + server-side deobfuscation so minified error
   stacks become actionable.
3. Framework integration packages (`@insightview/rum-react`,
   `@insightview/rum-vue`) so the SDK is idiomatic in the major
   frontend frameworks.

These were deferred because the MVP didn't need them. This iteration
closes all three gaps to reach feature parity with the original
research plan's RUM integration section.

## Decision

### Session replay

- **rrweb** is the upstream library. It is the de-facto open-source
  choice (FullStory, PostHog, Sentry, Datadog all use it) and the
  payload is 10–50× smaller than video.
- The SDK integrates rrweb as an **opt-in instrument**. Users
  enable it via `autoInstrument: { replay: true }` and a
  `replaySampleRate` that defaults to **0.05** (5% of sessions),
  so the heavy payload only hits small slices of traffic.
- Privacy-first masking is enforced **in the browser before
  serialization**: `maskAllInputs: true` is the default, and
  elements marked `class="rum-block"` are excluded entirely.
  No PII should be able to leave the page.
- The SDK flushes replay chunks on a **timed interval, on
  buffer overflow, and on `pagehide`** so mobile session-end
  doesn't lose the last chunk. `navigator.sendBeacon` is the
  transport; `fetch(keepalive)` is the fallback.
- Chunks are POSTed to `/v1/replay` on the rum-collector and
  stored in a new `RumReplayChunk` table in Postgres, keyed by
  `(sessionId, sequence)` so a dashboard can reconstruct a
  session's timeline.
- A full Grafana/React replay player is **not** in this iteration;
  the plumbing is in place and the dashboard shows a chunk count.
  The actual playback UI is Phase 4 work.

### Source map deobfuscation

- Customers POST compiled source maps to `/v1/source-maps`
  (on the API, not the RUM collector — source maps are a
  release-time artifact, not a runtime one). Keyed by
  `(tenantId, release, bundleUrl)` with SHA-256 content hashing
  for integrity.
- The API service exposes a `POST /v1/source-maps/resolve`
  endpoint that accepts a raw stack string plus a release tag
  and returns the deobfuscated stack. Enrichment uses the
  `source-map` npm package's `SourceMapConsumer`.
- Resolved stacks go back to the RUM dashboard for error-detail
  views. The `RumEvent` row retains the raw stack so a later
  re-resolution is possible if the source maps change.
- The recommended workflow pattern is a CI step after the build:
  `curl -F "release=$SHA" -F "bundleUrl=..." -F "content=@dist/app.js.map" /v1/source-maps`
  — a small action for this is Phase 4 work.

### Framework integration packages

Two tiny workspace packages, no upstream publishing for now:

- **`@insightview/rum-react`** — exports `RumProvider`,
  `useRumClient`, and `useTrackRoute` hooks. Integrates via a
  module-level singleton so components outside the provider
  (Storybook, tests) get a safe no-op client.
- **`@insightview/rum-vue`** — exports a Vue 3 plugin
  `InsightViewRum` that installs on `createApp(App).use(...)`,
  provides the RumClient via `inject("rum")`, and hooks
  `app.config.errorHandler` so uncaught errors during render
  land as RUM errors automatically.

Both packages are ~50 lines each and their only job is to make
the idiomatic usage pattern shorter than `init()` directly.

## Consequences

- RUM mode now covers the full research-plan surface: web vitals,
  errors, navigation, resources, session replay, source maps,
  and framework integrations.
- Two new Prisma tables (`SourceMap`, `RumReplayChunk`) means a
  migration diff. Init SQL regenerated in this iteration.
- The `rrweb` import is dynamic (`import("rrweb")` inside the
  installer) so sites that don't enable replay don't pay the
  bundle cost — important because rrweb is ~40 KB gzipped.
- The source-map service pulls in a Node dep (`source-map`) on
  the API — small, stable, well-known.

## Security notes

- Source maps contain full original source code and are
  typically treated as "sensitive but not secret". The API stores
  them per-tenant with a unique index so one tenant can't read
  another's maps.
- Session replay is a **privacy minefield**. The `maskAllInputs`
  default + opt-in `replay: true` + head-based sampling at 5%
  minimizes exposure, but teams should still:
  1. Add `class="rum-block"` to anything that could contain PII.
  2. Review the regulatory framework (GDPR Art. 6 lawful basis)
     for their jurisdiction before enabling.
  3. Retain chunks for ≤30 days by default.
- The collector's CORS is permissive; production deployments
  should tighten to a specific origin list via environment config.

## Alternatives considered

- **FullStory / Hotjar SDK**. Rejected — closed-source and
  proprietary ingest. rrweb is what they use under the hood
  anyway.
- **Server-side video recording** (via a headless browser
  re-playing the session). Rejected — orders of magnitude more
  expensive and doesn't cover mobile real-user sessions.
- **Pushing source maps as part of the monitors-as-code
  pipeline.** Interesting but conflates build-time artifacts
  with runtime configuration. A dedicated endpoint keeps the
  concerns separate.
