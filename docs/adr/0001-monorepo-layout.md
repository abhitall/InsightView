# ADR 0001 — Monorepo layout with pnpm workspaces

**Status**: Accepted
**Date**: MVP vertical slice

## Context

InsightView v1 was a single TypeScript project: one `src/`, one
`package.json`, one `action.yml`. The platform evolution introduces
at least seven services and five shared packages, each of which needs
its own dependencies, build output, and (eventually) Docker image.

We needed a layout that:

1. Avoids duplicating framework deps (Fastify, Prisma, TypeScript) in
   every service.
2. Lets services import each other's types without publishing to
   npm.
3. Supports per-service Docker builds that only touch files the
   service cares about.
4. Keeps the existing Playwright + web-vitals code reachable via a
   backwards-compat path.

## Decision

Use **pnpm workspaces** with the following layout:

```
/packages/*    - shared libraries (core, db, event-bus, observability, rum-sdk)
/apps/*        - runnable services (api, scheduler, runner, alerting,
                 rum-collector, dashboard, action-dispatcher)
/infra/*       - docker-compose, Dockerfiles, prometheus config, test-site, e2e
/monitors/*    - monitors-as-code YAML files (deployed via the action)
/docs/*        - ARCHITECTURE, ROADMAP, GAP_ANALYSIS, ADRs
```

Shared packages live under `packages/` and are consumed via
`workspace:*` dependencies. Services live under `apps/` and each
has its own `package.json`, `tsconfig.json`, and entry point.

pnpm is the chosen package manager because:

- It correctly links peer dependencies across workspace packages
  (critical for `@playwright/test` being used by both the runner and
  the e2e harness).
- `pnpm --filter` gives us per-service build/start scripts without
  a second tool like Turborepo (rejected for MVP scope).
- `corepack enable` + `corepack prepare pnpm@10.0.0 --activate` makes
  it reproducible in CI and Docker without extra installers.

## Consequences

- Every service imports shared logic via `@insightview/*` — no
  relative path imports that cross package boundaries.
- Every service's Dockerfile follows the same pattern: copy all
  `package.json` manifests, `pnpm install`, then copy the actual
  source. Caching is per-manifest-set rather than per-file.
- The legacy `src/` directory was relocated to
  `apps/runner/src/legacy/` so the original Playwright fixture path
  still works (via `command: legacy-run`).
- Adding a new service later is a well-defined operation: new
  `apps/xxx/`, new workspace entry (already covered by the glob in
  `pnpm-workspace.yaml`), new Docker build context.

## Alternatives considered

- **Nx** — too heavy for MVP scale; powerful task graph and caching
  but we don't have enough packages yet to benefit.
- **Turborepo** — nice `turbo run build` UX but duplicates what pnpm's
  `--filter` already does. Will revisit in Phase 1 if CI times grow.
- **Single repo, single package.json** — fights the design. We'd end
  up with a 20k-line tsconfig and no way to ship the runner as its
  own image without shipping every other service's deps too.
