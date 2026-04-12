# ADR 0006 — GitHub Action as a command dispatcher

**Status**: Accepted
**Date**: MVP vertical slice

## Context

v1 of the project *was* a GitHub Action. Customers have workflows
that import `abhitall/InsightView@v1` and expect the action to
execute a Playwright run, push to Prometheus, and upload to S3.

Platform-ifying the project without breaking those workflows means
the action must:

1. Keep the exact v1 behavior when called the v1 way.
2. Expose new capabilities (run, deploy, validate, status) without
   adding four more action entry points.
3. Be scriptable from CI so every platform capability is reachable
   without a separate CLI install.

## Decision

Turn `action.yml` into a **composite action with a `command` input**
that selects one of five subcommands:

| command      | Behavior                                                  |
|--------------|-----------------------------------------------------------|
| `run`        | POST /v1/runs, poll for terminal, set run_id / run_status outputs |
| `deploy`     | Walk monitors_path, POST every YAML to /v1/monitors:apply |
| `validate`   | Parse + Zod-validate YAML, emit GitHub annotations       |
| `status`     | GET /v1/runs?checkName=..., print history, exit non-zero if latest failed |
| `legacy-run` | Default. Runs `pnpm --filter @insightview/runner run legacy:test`, preserving v1 behavior exactly. |

The action's composite step dispatches via a single bash `if/else`
that invokes the `@insightview/action-dispatcher` package's CLI.
Subcommands are implemented as individual TS files under
`apps/action-dispatcher/src/commands/` so each is independently
testable.

Environment variables carry state between steps:

- `INSIGHTVIEW_API_URL` / `INSIGHTVIEW_API_TOKEN` — platform auth.
- `INSIGHTVIEW_CHECK_NAME` — which check `run` or `status` operates on.
- `INSIGHTVIEW_MONITORS_PATH` — which directory `deploy` and
  `validate` walk.
- `GITHUB_OUTPUT` / `GITHUB_STEP_SUMMARY` — receive run_id, run_status,
  and human-readable summaries from the dispatcher.

## Consequences

- Existing workflows keep working: `uses: abhitall/InsightView@v1` or
  a checkout + `uses: ./` defaults to `command: legacy-run`.
- New workflows are declarative: three-line calls with `command: run`,
  `command: deploy`, `command: validate` (see `.github/workflows/`).
- The action is self-contained — it installs pnpm, runs the workspace
  install, and shells the right entry point. No npm publishing
  required for MVP.
- The dispatcher is a thin wrapper around the REST API, so every
  operation a customer can do through the action is also available
  via `curl` if they prefer. No lock-in.

## Alternatives considered

- **Five separate actions** (`insightview/run`, `insightview/deploy`,
  etc.). Cleaner per-action schema but forces customers to import
  five repos and blocks us from sharing installation cost.
- **Docker-based action**. Smaller install, larger cold-start; also
  makes `legacy-run` hard because the Playwright image is already 2
  GB. Rejected for now, will revisit after Phase 1 stabilizes.
- **Stand-alone CLI distributed via `npm i -g`**. Defensible but
  adds a second install step before the action is useful. Composite
  action keeps everything in one place.
