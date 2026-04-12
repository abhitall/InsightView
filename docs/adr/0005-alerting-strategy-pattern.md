# ADR 0005 — Alerting uses the strategy pattern

**Status**: Accepted
**Date**: MVP vertical slice

## Context

Alerting engines tend to accumulate special cases. Every new customer
request ("we want to fire only if it's failing in > 3 locations",
"we want to ignore maintenance windows", "we want a P90 check, not
a mean") becomes an `if` branch in a monolithic evaluator until the
evaluator collapses under its own weight.

The MVP needs three evaluation kinds to ship (threshold, consecutive
failures, composite) and a clear path to add anomaly detection, rate
thresholds, seasonality, and multi-location correlation in later
phases.

## Decision

Define a `Strategy` interface in
`apps/alerting/src/strategies/index.ts`:

```ts
interface Strategy {
  evaluate(ctx: EvaluationContext): Decision;
}

interface Decision {
  shouldFire: boolean;
  shouldResolve: boolean;
  reason: string;
}
```

Every concrete evaluator implements `Strategy` and registers itself
in the map keyed by the `AlertStrategy` Prisma enum. The
`CompositeStrategy` delegates to other registered strategies,
proving the interface supports composition.

Notification channels follow the same pattern — `channelFor(type)`
returns an implementation of `NotificationChannelImpl`. Slack, generic
webhook, and stdout are registered today; PagerDuty and email will
register themselves in Phase 1.

## Consequences

- Adding a new evaluation kind is *three* files: a new
  `XxxStrategy.ts`, a registry entry, and a Prisma enum value. No
  existing file needs surgery.
- The evaluator in `apps/alerting/src/evaluator.ts` is 50 lines —
  it loads rules, calls `strategyFor(rule.strategy).evaluate(...)`,
  and acts on the Decision. Easy to read, easy to test.
- Composition is first-class. A future "all of the following, but
  only during business hours" rule is a new strategy that wraps the
  existing ones plus a time filter.

## Alternatives considered

- **Single monolithic evaluator with if/else**. Rejected — we've
  seen this pattern die in every monitoring tool that's been in
  production more than two years.
- **DSL / expression language**. Tempting (Grafana's Alertmanager
  has Prometheus expressions, Datadog has DSL filters) but a DSL
  needs its own parser, type system, and testing. Too heavy for MVP.
  Will likely reintroduce as a "Composite with expression strings"
  option in Phase 4.
- **Ship only one strategy (threshold) and add more later**. We did
  consider this but both `CONSECUTIVE_FAILURES` and `COMPOSITE` are
  so cheap to add on top of the interface that shipping all three
  proves the interface is right.
