# ADR 0011 — Anomaly detection alert strategy

**Status**: Accepted
**Date**: Iteration 4

## Context

The original research plan called for a layered anomaly detection
stack:

- **Layer 1** (real-time): Z-score + rolling percentiles. O(N)
  per evaluation, zero dependencies, catches most "yesterday it
  was 1200ms, today it's 4500ms" regressions that static
  thresholds miss.
- **Layer 2** (near-real-time): Isolation Forest for multivariate
  anomalies. Needs scikit-learn or equivalent.
- **Layer 3** (batch): Meta's Prophet for seasonal/trend-aware
  detection. Needs Python + daily retraining.

Plus ensemble voting so a majority of models must agree before
firing, which dramatically reduces false positives.

Shipping all three layers at once is a research project. Shipping
Layer 1 and proving the strategy interface can host Layers 2 + 3
later is an engineering project — and that's what this ADR does.

## Decision

Add `AnomalyDetectionStrategy` to `apps/alerting/src/strategies/`
implementing Layer 1 of the research plan: rolling z-score over
the last N historical samples.

### Algorithm

1. Read the last `window` (default 20) historical samples for
   the requested metric from `ctx.historicalValues` (pre-populated
   by the evaluator).
2. If fewer than `minSamples` (default 5), return no-fire with
   "awaiting data" reason — never fire before we can compute a
   meaningful standard deviation.
3. Compute the mean and the sample standard deviation (Bessel's
   correction, `/(n-1)`) over the window.
4. Compute the z-score of the current observation:
   `z = (observed - mean) / stddev`.
5. Fire when `|z| >= threshold` (default 3.0) in the configured
   direction (`higher` by default — most monitoring cares about
   regressions, not improvements).
6. Resolve when the metric returns within bounds.

### Edge cases

- **Zero variance**: when the history is perfectly flat the
  stddev is 0. Returning +/-Infinity would fire on any tiny
  change — not useful. Instead we return "σ=0, awaiting
  variance" and the strategy does not fire until the rolling
  window contains enough natural jitter.
- **Metric missing from the latest run**: return "metric not
  reported" and do not fire. This keeps alerts tied to observed
  degradation, not monitoring-pipeline bugs.
- **Sparse history**: < `minSamples` returns "need N more
  samples" and does not fire. Prevents false positives during
  the first few runs after a new monitor is deployed.

### Configuration

```yaml
strategy: ANOMALY_DETECTION
expression:
  metric: LCP          # or "CLS", "INP", "FCP", "TTFB", "duration"
  threshold: 3.0       # z-score (default 3.0)
  window: 20           # last-N baseline (default 20)
  minSamples: 5        # minimum before firing (default 5)
  direction: higher    # "higher" | "lower" | "both" (default "higher")
```

### RUM-driven variant

Add a **second** new strategy `RUM_METRIC` that fires on
aggregated real-user data rather than the current synthetic
run. Uses the same interface, different inputs:

```yaml
strategy: RUM_METRIC
expression:
  metric: LCP
  percentile: p75      # "p50" | "p75" | "p95" | "mean"
  operator: ">"        # "<", ">", "<=", ">="
  value: 2500
  minSampleCount: 100
```

The evaluator pre-computes a 15-minute rolling RUM aggregate
before calling the strategy, so the strategy itself stays pure
and unit-testable.

## Consequences

- Two new enum values in `AlertStrategy` (both Prisma + core).
- Both strategies slot into the existing strategy registry, so
  no changes to alert dispatch or channel plumbing.
- The evaluator now does a batch DB read to populate
  `historicalValues` when an ANOMALY_DETECTION rule is present.
  One query per run in the window (up to 20); guarded behind a
  `needsAnomaly` flag so non-anomaly rules pay zero cost.
- Layers 2 + 3 from the research plan plug in as additional
  strategies — `AnomalyIsolationForestStrategy`,
  `AnomalyProphetStrategy` — without touching anything else.
- `CompositeStrategy` already supports delegation, so an ensemble
  like "fire only if both z-score and IF agree" is one
  `COMPOSITE` rule away.

## Unit tests

`apps/alerting/src/strategies/anomaly.spec.ts` covers the edge
cases that drove the design:

- Does not fire when < minSamples
- Fires when z > threshold (higher direction)
- Does not fire when within bounds
- Fires on drops when direction=lower
- Does not fire when stddev is 0

Plus 3 tests for `RUM_METRIC` covering the sample-count and
missing-aggregate branches. **8 new tests total**, bringing the
suite to 41/41 passing.

## Alternatives considered

- **Static percentile threshold** (e.g. "alert if LCP > p95 of
  last week"). Simpler but requires a longer history window and
  doesn't adapt to seasonality. Z-score works better for the
  short windows monitoring typically operates on.
- **Seasonal decomposition** (STL). Much more powerful for
  day-of-week patterns but needs weeks of history and adds a
  dependency. Defer to Phase 5.
- **MAD (median absolute deviation)** instead of z-score. More
  robust to outliers in the history. Z-score is the standard
  and has better-known failure modes; MAD is Phase 5.

## References

- [Anomaly Detection in Time Series Using Statistical Analysis (Booking.com)](https://medium.com/booking-com-development/anomaly-detection-in-time-series-using-statistical-analysis-cc587b21d008)
- [Z-Score Anomaly Detection: Practical Guide](https://mcpanalytics.ai/articles/z-score-anomaly-detection-practical-guide-for-data-driven-decisions)
- [Tinybird — Simple statistics for anomaly detection](https://www.tinybird.co/blog/anomaly-detection)
- [VictoriaMetrics anomaly detection handbook chapter 3](https://victoriametrics.com/blog/victoriametrics-anomaly-detection-handbook-chapter-3/)
