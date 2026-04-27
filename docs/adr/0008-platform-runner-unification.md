# ADR 0008 — Platform runner unification via synthetic-kit

**Status**: Accepted
**Date**: Iteration 3

## Context

ADR 0007 introduced `packages/synthetic-kit` for the Actions-native
execution mode. The platform mode's `apps/runner` still contained
its own copy of:

- Web Vitals collection logic (with the CDN fetch bug)
- Navigation Timing collection
- Assertion evaluation
- Prometheus Pushgateway exporter
- S3 artifact exporter
- Error handling

This meant every reliability fix had to be written twice: once in
synthetic-kit for Actions-native, and a second time in apps/runner
for platform mode. We already observed drift in the first iteration
(the platform runner's web-vitals collector hadn't yet adopted
`reportAllChanges` or the forced visibilitychange fix).

## Decision

**`apps/runner/src/executeRun.ts` is now a thin wrapper around
`@insightview/synthetic-kit`'s `runCheck`.** The runner's
responsibilities are:

1. Consume `CheckScheduled` events from the BullMQ queue.
2. Claim the run via idempotent `QUEUED → RUNNING` transition.
3. Build a `MonitorSpec` from the event payload.
4. Invoke `runCheck(spec, { tenantId, location, artifactsDir })`.
5. Translate the returned `ResultEnvelope` into Prisma `CheckResult`
   rows via `insertResults`.
6. Publish `CheckCompleted` back to the queue for the alerting
   service to consume.

All Playwright orchestration, Web Vitals collection, assertion
evaluation, error classification, CDP metrics, CDN cache detection,
retry with flaky detection, and the full exporter set live in
synthetic-kit. There is now exactly **one source of truth** for
"how a synthetic run is executed."

## Consequences

### Good

- Every reliability fix auto-applies to both execution modes.
- `apps/runner/src/executeRun.ts` shrank from ~230 lines to ~130.
- The old `apps/runner/src/collectors`, `apps/runner/src/exporters`,
  and `apps/runner/src/assertions.ts` were removed entirely.
- Adding a new auth strategy, network profile, exporter, or
  collector is a one-file change in synthetic-kit that benefits
  both modes.
- Fewer moving parts means fewer tests: the synthetic-kit's unit
  tests (errors, assertions, parse, strategies) cover the logic
  for both modes.

### Neutral

- The platform runner is still responsible for DB persistence and
  event bus plumbing — synthetic-kit doesn't know about Postgres
  or BullMQ. This is correct: the kit is an abstraction over
  "execute a monitor", not "run a monitoring platform".
- The runner now depends on synthetic-kit via a `workspace:*`
  dependency. No publishing required.

### Minor limitations

- The platform runner still uses its own exporter set
  (stdout + pushgateway + s3 when configured) — the `platform`
  exporter isn't used because the runner IS the platform. This is
  deliberate.
- Platform exporters wrap the ResultEnvelope → CheckResult
  translation in the runner, so the envelope format is the same
  regardless of mode (enabling ADR 0007's bridging promise).

## Sequence: platform-mode run after ADR 0008

```
BullMQ CheckScheduled
    ↓
runner/main.ts  markRunStarted  (idempotent)
    ↓
runner/executeRun.ts  runCheck(spec)
    ↓
synthetic-kit/runCheck.ts
    ├─ Launch Chromium
    ├─ BrowserContext with bypassCSP
    ├─ installWebVitalsCollector (bundled IIFE)
    ├─ Apply auth strategy
    ├─ For each step:
    │   ├─ Navigate
    │   ├─ Collect web vitals (forced visibilitychange)
    │   ├─ Collect navigation timing (fallback)
    │   ├─ Collect resource stats
    │   ├─ Collect CDP metrics
    │   ├─ Classify CDN cache from headers
    │   ├─ Run assertions
    │   └─ Retry on TRANSIENT errors (flaky tracking)
    ├─ Build ResultEnvelope
    └─ Fire exporters
    ↓
runner/executeRun.ts  insertResults → Prisma CheckResult rows
    ↓
runner/main.ts  markRunCompleted + CheckCompleted event
    ↓
alerting/main.ts  evaluate strategies → incidents → channels
```

## Alternatives considered

- **Leave the two runners independent.** Rejected — the drift was
  already measurable after one iteration. Shared code wins.
- **Factor out a tiny "playwright-orchestration" package that the
  platform runner uses, but keep it separate from synthetic-kit.**
  Rejected — that's just synthetic-kit renamed. The cost of one
  workspace dependency is trivial.
- **Make synthetic-kit aware of Postgres so the runner is a pure
  thin shim.** Rejected — the kit is deliberately storage-agnostic
  so it can be used from an Actions workflow with no database
  at all.
