import { prisma } from "../client.js";
import type { WatchdogHeartbeat } from "../generated/client/index.js";

/**
 * Dead-man's-switch state. The scheduler leader upserts a heartbeat every N
 * seconds; the API's /healthz endpoint + Prometheus exporter check the age
 * and escalate if stale. This is the primitive the analysis called out as
 * the critical gap vs. GitHub Actions cron.
 */

export async function beatHeartbeat(
  scope: string,
  leaderId: string,
  expectedIntervalSeconds: number,
): Promise<WatchdogHeartbeat> {
  return prisma.watchdogHeartbeat.upsert({
    where: { scope },
    create: {
      scope,
      leaderId,
      expectedIntervalSeconds,
    },
    update: {
      leaderId,
      expectedIntervalSeconds,
    },
  });
}

export async function getHeartbeat(
  scope: string,
): Promise<WatchdogHeartbeat | null> {
  return prisma.watchdogHeartbeat.findUnique({ where: { scope } });
}

export async function isHeartbeatStale(
  scope: string,
  graceFactor = 3,
): Promise<{ stale: boolean; ageMs: number | null }> {
  const beat = await getHeartbeat(scope);
  if (!beat) return { stale: true, ageMs: null };
  const ageMs = Date.now() - beat.lastBeatAt.getTime();
  const thresholdMs = beat.expectedIntervalSeconds * 1000 * graceFactor;
  return { stale: ageMs > thresholdMs, ageMs };
}
