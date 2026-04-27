# ADR 0012 — Auth, RBAC, audit log, and OpenTelemetry

**Status**: Accepted
**Date**: Iteration 4

## Context

Phase 1 of the roadmap called for Bearer token authentication,
role-based access control, a structured audit log, and
OpenTelemetry observability. Phase 4 called for OpenTelemetry
trace correlation — pushing the trace from the synthetic runner
through to the customer's backend so you can correlate
"synthetic check saw 5s response" with "my DB query took 4.8s
of that window".

This ADR batches Phase 1 (auth, RBAC, audit, OTel baseline) with
Phase 4's trace correlation because they share the same
underlying mechanism: W3C trace-context headers propagating
through Fastify, the event bus, and outbound Playwright
navigation.

## Decision

### API tokens

New `ApiToken` Prisma table:
- `tokenHash` (SHA-256 of the raw token, never stored in plaintext)
- `role` — `admin | write | read`
- `scopes` — free-form string array
- `expiresAt`, `revokedAt`, `lastUsedAt`

Raw tokens look like `iv_<48-hex>` and are returned **only once**
at mint time. A leaked token is revoked via
`DELETE /v1/tokens/:id` which flips `revokedAt` — rows are not
deleted so the audit trail survives.

### RBAC via a Fastify plugin

`apps/api/src/plugins/tenant.ts` is now a three-mode auth
resolver:

1. **Static `API_TOKEN` env var**. Matches → admin. Kept for
   zero-config local dev.
2. **Issued tokens** (bearer starts with `iv_`). Looked up via
   `verifyToken(raw)` which SHA-256 hashes and hits the
   `ApiToken` table. Revoked/expired → 401. Valid → populates
   `req.auth = { tokenId, role, scopes }`.
3. **No token present** → anonymous read-only client (matches
   the MVP's unauthenticated default). The production deployment
   should always set API_TOKEN or enable token minting.

Route guards are added via the `preHandler` option:

```ts
app.post("/v1/tokens",
  { preHandler: requireRole("admin") },
  async (req, reply) => { ... }
);
```

The three-rung hierarchy is `read < write < admin`.

### Audit log

`AuditLog` table with one row per mutating request. Captures
`(actor, action, resource, resourceId, metadata)` so queries
like "all changes to this rule" are fast. Every token mint,
token revoke, and monitor deployment emits a row via the
`recordAudit` helper.

The existing `MonitorDeployment` table survives because it's a
specialized monitors-as-code table with diff + yamlHash; the
new `AuditLog` is the generic audit surface.

### OpenTelemetry

`packages/observability/src/tracing.ts` exports `initTracing`,
`withSpan`, `injectTraceHeaders`, and `extractTraceContext`.

The OTLP/HTTP exporter is wired only when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set — absence means spans still
exist and propagate but are dropped. This lets us enable W3C
trace-context propagation in production without forcing every
developer to run a collector locally.

### Trace propagation into the target site

The synthetic-kit's `runCheck` now calls `injectTraceHeaders`
and passes the result to
`context.setExtraHTTPHeaders(traceHeaders)`. Every outbound
request the Playwright context makes — including the main
navigation — carries a `traceparent` header. The target's
backend (with OTel auto-instrumentation) continues the same
trace, so a synthetic run becomes the root span of a distributed
trace that flows through the customer's stack.

This is the Phase 4 "OpenTelemetry trace correlation" feature:
an on-call engineer debugging a synthetic failure can click
through from the ResultEnvelope → trace id → Jaeger / Grafana
Tempo → the exact backend span that was slow.

### Public status pages

Bonus feature added in this iteration because it shares auth
concerns: `GET /v1/status.json` and `GET /v1/status/*` render a
public status page that does NOT require auth. The tenant
plugin's `PUBLIC_PATHS` list allow-lists them.

The HTML renderer is dependency-free — one template literal —
so the status page stays fast and works even if the dashboard
isn't deployed.

## Consequences

- Three new Prisma tables: `ApiToken`, `AuditLog`, `DomainEvent`.
- Two new routes: `/v1/tokens` (admin only) and `/v1/audit`
  (write+).
- The existing `API_TOKEN` static env path still works, so
  deployments that were using it don't need to migrate.
- OpenTelemetry adds ~6 packages to `observability` but they're
  zero-overhead when no OTLP endpoint is set: no spans are
  exported, and propagation is O(1) header injection/extraction.
- `synthetic-kit` lazy-imports observability so it can be used
  without pulling in OTel when tracing is disabled.
- The `synthetic-kit` becomes the root of a distributed trace
  even without the target propagating downstream — the trace is
  usable in a single-service form if the customer hasn't
  instrumented their backend yet.

## Security notes

- **Token hashing** prevents offline enumeration from a DB
  leak. SHA-256 is appropriate here because the tokens are
  long-random-bytes, not low-entropy passwords — no rainbow
  table attack applies.
- **Audit log is append-only** (no update/delete repository
  methods). Administrators who want to redact rows should
  truncate the table directly with a DBA process.
- **OTLP endpoint credentials** are not yet implemented — the
  exporter assumes an unauthenticated collector. Phase 5 work
  will add header-based auth via `OTEL_EXPORTER_OTLP_HEADERS`.

## References

- [OpenTelemetry W3C Trace Context propagation (JavaScript)](https://opentelemetry.io/docs/languages/js/propagation/)
- [Last9 — Traceparent: how OpenTelemetry connects microservices](https://last9.io/blog/traceparent-explained/)
- [Node.js Observability Stack in 2026](https://dev.to/axiom_agent/the-nodejs-observability-stack-in-2026-opentelemetry-prometheus-and-distributed-tracing-229b)
- [Tracetest — Propagating OTel context browser → backend](https://tracetest.io/blog/propagating-the-opentelemetry-context-from-the-browser-to-the-backend)
