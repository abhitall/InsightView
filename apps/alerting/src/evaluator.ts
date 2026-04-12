import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "@insightview/observability";
import type {
  CheckCompletedPayload,
  TenantContext,
} from "@insightview/core";
import {
  listEnabledRulesForCheck,
  listRunsByCheck,
  createIncident,
  findFiringIncident,
  resolveIncidentsForRule,
  type AlertIncident,
} from "@insightview/db";
import { strategyFor } from "./strategies/index.js";

export async function evaluateCompletion(
  ctx: TenantContext,
  payload: CheckCompletedPayload,
  log: Logger,
): Promise<AlertIncident[]> {
  const rules = await listEnabledRulesForCheck(ctx, payload.checkId);
  if (rules.length === 0) return [];

  const recentRuns = await listRunsByCheck(ctx, payload.checkId, 20);
  const createdIncidents: AlertIncident[] = [];

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
      createdIncidents.push(incident);
    } else if (decision.shouldResolve) {
      const count = await resolveIncidentsForRule(ctx, rule.id);
      if (count > 0) {
        log.info({ rule: rule.name, count }, "resolved stale incidents");
      }
    }
  }

  return createdIncidents;
}
