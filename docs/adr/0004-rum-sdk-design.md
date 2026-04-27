# ADR 0004 — RUM SDK design

**Status**: Accepted
**Date**: MVP vertical slice

## Context

The RUM feature requires a browser SDK that:

- Collects Core Web Vitals without fighting the pre-existing Chrome
  Performance Observer lifecycle.
- Transports events reliably across page visibility changes, tab
  closes, and mobile background transitions.
- Is small enough (< 10 KB gzipped) that customers actually include
  it.
- Isn't proprietary — customers must be able to read the code.

## Decision

Build a purpose-built SDK in `packages/rum-sdk` that composes the
existing `web-vitals` npm package. Key design elements:

1. **ESM + IIFE dual builds** via esbuild. The IIFE bundle is what
   the test-site (and customer pages) load via `<script>`; the ESM
   build is what a bundled React/Vue app would `import` after
   publishing.
2. **Tree-shakeable auto instruments**. `instruments/webVitals.ts`,
   `instruments/errors.ts`, `instruments/navigation.ts`,
   `instruments/resources.ts` are separate modules enabled by
   explicit `autoInstrument` options so customers pay only for what
   they use.
3. **Shared Zod schema** at `packages/rum-sdk/src/schema.ts`. The
   rum-collector imports the exact same schema via the
   `@insightview/rum-sdk/schema` subpath export, so the SDK and
   server agree on the wire format by construction.
4. **Batching buffer** that flushes on 20 events OR 5 seconds OR
   `visibilitychange -> hidden` OR `pagehide`. The last two are
   non-optional because mobile Safari aggressively kills tabs.
5. **Transport: `navigator.sendBeacon` with a `fetch(keepalive)`
   fallback**. Both are fire-and-forget; no promise is awaited by
   the event loop because page-unload is the most important flush.
6. **Session stitching via `sessionStorage`**. Not cookies (no
   cross-tab bleed, no consent popups for functional storage). UUID
   generated on first `init()` and persisted for the session
   lifetime.
7. **Head-based sampling**: `sampleRate: 0..1` determines at init
   time whether a session reports at all. If dropped, `init` returns
   a no-op client so customer code doesn't need guards.

## Consequences

- The wire format is stable: breaking changes require bumping
  `rumEventBatchSchema` and handling both versions in the collector.
- The SDK package is published to the npm registry in Phase 1 as
  `@insightview/rum-sdk`. For MVP it's workspace-only and the
  test-site loads the IIFE from inside its nginx container.
- Session replay (rrweb) is intentionally excluded from MVP —
  it's a 10x volume increase and demands privacy-first masking
  that requires careful UX design.
- Framework integrations (React, Vue) ship in Phase 3 as separate
  packages.

## Alternatives considered

- **Use Grafana Faro directly**. Tempting, and we may re-export from
  it if Phase 3 aligns. But Faro's bundle size and opinionated
  backend contract don't fit the "customers own their data" stance.
- **Use OpenTelemetry-JS for everything**. Strong vendor-agnostic
  story, but 30+ KB gzipped and the Web Vitals bridge is still
  experimental. Will revisit for Phase 3 where we need OTel trace
  correlation.
- **Use the existing `web-vitals` CDN directly**. The legacy
  synthetic collector already does this. It's fine for a runner
  where bandwidth is free, but a customer-shipped SDK cannot be
  network-dependent at init time.
