import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "@insightview/observability";
import type {
  CheckCompletedPayload,
  TenantContext,
} from "@insightview/core";
import {
  listEnabledRulesForCheck,
  listRunsByCheck,
  listResultsByRun,
  rumWebVitalPercentiles,
  createIncident,
  findFiringIncident,
  resolveIncidentsForRule,
  type AlertIncident,
  type AlertRule,
} from "@insightview/db";
import { strategyFor } from "./strategies/index.js";

export interface FiredIncident {
  incident: AlertIncident;
  rule: AlertRule;
}

/**
 * Evaluator orchestration. Loads the enabled rules for a check,
 * pre-populates strategy-specific context (historicalValues for
 * ANOMALY_DETECTION, rumAggregates for RUM_METRIC), then walks
 * the registry and turns decisions into incident create / resolve
 * operations.
 *
 * Anomaly & RUM pre-population is done here rather than inside the
 * strategies themselves so the strategies remain pure functions
 * that unit tests can hammer without a database.
 */

export async function evaluateCompletion(
  ctx: TenantContext,
  payload: CheckCompletedPayload,
  log: Logger,
): Promise<FiredIncident[]> {
  const rules = await listEnabledRulesForCheck(ctx, payload.checkId);
  if (rules.length === 0) return [];

  const recentRuns = await listRunsByCheck(ctx, payload.checkId, 20);
  const createdIncidents: FiredIncident[] = [];

  // Pre-compute historical metric samples for anomaly detection.
  // We only do this work if at least one rule actually needs it.
  const needsAnomaly = rules.some((r) => r.strategy === "ANOMALY_DETECTION");
  const historicalValues: Record<string, number[]> = {};
  if (needsAnomaly) {
    // For every prior run in history, look up its results and
    // harvest each web-vital measurement. One DB call per run is
    // acceptable at 20-run window; the query is indexed.
    for (const run of recentRuns.slice(0, 20)) {
      if (run.id === payload.runId) continue;
      try {
        const results = await listResultsByRun(ctx, run.id);
        for (const r of results) {
          const vitals = (r.webVitals as Record<string, number>) ?? {};
          for (const [k, v] of Object.entries(vitals)) {
            if (typeof v === "number" && Number.isFinite(v)) {
              (historicalValues[k] = historicalValues[k] ?? []).push(v);
            }
          }
          // `duration` bucket from the step duration.
          if (typeof r.durationMs === "number") {
            (historicalValues.duration = historicalValues.duration ?? []).push(
              r.durationMs,
            );
          }
        }
      } catch (err) {
        log.warn({ err, runId: run.id }, "failed to load results for history");
      }
    }
  }

  // Pre-compute RUM aggregates for RUM_METRIC rules. Real percentiles
  // are computed via Postgres `percentile_cont`; the previous
  // `avg * 1.2` / `avg * 1.5` placeholders are gone.
  const needsRum = rules.some((r) => r.strategy === "RUM_METRIC");
  const rumAggregates: Record<
    string,
    { p50: number; p75: number; p95: number; count: number; mean: number }
  > = {};
  if (needsRum) {
    // For MVP we treat the configured site-id env as the lookup key.
    // In a production deployment the rule would carry its own siteId
    // in `expression.siteId`; this keeps the wiring simple.
    const siteId = process.env.RUM_SITE_ID ?? "default";
    try {
      const distributions = await rumWebVitalPercentiles(
        ctx,
        siteId,
        15 * 60 * 1000, // 15-minute window
      );
      for (const row of distributions) {
        rumAggregates[row.metric] = {
          p50: row.p50,
          p75: row.p75,
          p95: row.p95,
          count: row.count,
          mean: row.mean,
        };
      }
    } catch (err) {
      log.warn({ err }, "failed to load RUM aggregate");
    }
  }

  for (const rule of rules) {
    const strategy = strategyFor(rule.strategy);
    const decision = strategy.evaluate({
      rule,
      latestRun: {
        id: payload.runId,
        status: payload.status,
        durationMs: payload.durationMs,
        summary: payload.summary,
        errorMessage: payload.errorMessage ?? null,
      },
      history: recentRuns,
      historicalValues,
      rumAggregates,
    });

    if (decision.shouldFire) {
      const dedupeKey = createHash("sha256")
        .update(`${rule.id}:${payload.checkId}:${rule.severity}`)
        .digest("hex");
      const existing = await findFiringIncident(ctx, dedupeKey);
      if (existing) {
        log.info(
          { incidentId: existing.id, rule: rule.name },
          "incident already firing, skipping duplicate",
        );
        continue;
      }
      const incident = await createIncident(ctx, {
        id: `inc_${randomUUID()}`,
        ruleId: rule.id,
        checkId: payload.checkId,
        runId: payload.runId,
        severity: rule.severity,
        dedupeKey,
        payload: {
          reason: decision.reason,
          rule: rule.name,
          latestRun: payload,
        },
      });
      log.warn(
        { incidentId: incident.id, rule: rule.name, severity: rule.severity },
        "incident fired",
      );
      createdIncidents.push({ incident, rule });
    } else if (decision.shouldResolve) {
      const count = await resolveIncidentsForRule(ctx, rule.id);
      if (count > 0) {
        log.info({ rule: rule.name, count }, "resolved stale incidents");
      }
    }
  }

  return createdIncidents;
}
