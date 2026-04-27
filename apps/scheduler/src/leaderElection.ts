import type { Redis } from "ioredis";
import type { Logger } from "@insightview/observability";

const LEADER_KEY = "insightview:scheduler:leader";
const LEASE_MS = 30_000;
const RENEW_MS = 10_000;

// Atomic renew-if-value-matches: PEXPIRE only if the key still holds
// our leaderId. Returns 1 on successful renewal, 0 if the key is no
// longer ours (lost leadership). Without this, a GET-then-PEXPIRE
// sequence can extend a *new* leader's TTL during the window between
// the two calls.
const RENEW_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
else
  return 0
end
`;

const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

/**
 * Redis-based leader election. `SET key value NX PX lease` either wins the
 * lease or finds an existing owner. The winner renews periodically via an
 * atomic Lua script that only extends the TTL when the key still holds
 * this node's leaderId; a loss of connectivity causes the lease to expire
 * and another node takes over.
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
      if (current) {
        // Try to renew atomically. The Lua script checks the key value
        // and PEXPIREs in a single Redis command, so we cannot extend
        // a key that's already been claimed by another node.
        const renewed = await redis.eval(
          RENEW_LUA,
          1,
          LEADER_KEY,
          leaderId,
          String(LEASE_MS),
        );
        if (renewed === 1) {
          // Still leader — TTL refreshed.
          return;
        }
        // Lost leadership: another node owns the key (or the lease
        // expired and we missed our renewal window).
        current = false;
        onChange(false);
        log.warn({ leaderId }, "lost leadership during renew");
        return;
      }

      // Not currently leader — try to claim a vacant lease.
      const claimed = await redis.set(
        LEADER_KEY,
        leaderId,
        "PX",
        LEASE_MS,
        "NX",
      );
      if (claimed === "OK") {
        current = true;
        onChange(true);
        log.info({ leaderId }, "became leader");
      }
      // claimed === null means another leader already holds the lease;
      // stay in follower state and try again on the next tick.
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
    // Best-effort release: only delete the key if it's still ours.
    void redis.eval(RELEASE_LUA, 1, LEADER_KEY, leaderId);
  };
}
