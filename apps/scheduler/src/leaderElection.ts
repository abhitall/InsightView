import type { Redis } from "ioredis";
import type { Logger } from "@insightview/observability";

const LEADER_KEY = "insightview:scheduler:leader";
const LEASE_MS = 30_000;
const RENEW_MS = 10_000;

/**
 * Redis-based leader election. `SET key value NX PX lease` either wins the
 * lease or finds an existing owner. The winner renews periodically; a loss
 * of connectivity causes the lease to expire and another node takes over.
 */
export function startLeaderLoop(
  redis: Redis,
  leaderId: string,
  log: Logger,
  onChange: (isLeader: boolean) => void,
): () => void {
  let current = false;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const existing = await redis.get(LEADER_KEY);
      if (existing === leaderId) {
        // Still leader — refresh lease.
        await redis.pexpire(LEADER_KEY, LEASE_MS);
        if (!current) {
          current = true;
          onChange(true);
        }
      } else if (!existing) {
        // Vacant — try to claim.
        const result = await redis.set(LEADER_KEY, leaderId, "PX", LEASE_MS, "NX");
        if (result === "OK") {
          current = true;
          onChange(true);
          log.info({ leaderId }, "became leader");
        } else if (current) {
          current = false;
          onChange(false);
        }
      } else {
        // Another leader owns the lease.
        if (current) {
          current = false;
          onChange(false);
          log.warn({ leaderId, current: existing }, "lost leadership");
        }
      }
    } catch (err) {
      log.error({ err }, "leader election tick failed");
      if (current) {
        current = false;
        onChange(false);
      }
    }
  };

  const interval = setInterval(() => void tick(), RENEW_MS);
  void tick();

  return () => {
    stopped = true;
    clearInterval(interval);
    // Best-effort release.
    void redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
      1,
      LEADER_KEY,
      leaderId,
    );
  };
}
