import cron, { type ScheduledTask } from "node-cron";
import { envelope, MessageTypes, Topics } from "@insightview/core";
import type { RepeatingJobScheduler } from "../types.js";
import type { KafkaEventBus } from "./KafkaEventBus.js";

/**
 * Kafka-compatible cron scheduler. Kafka has no built-in delayed
 * or repeating job primitive, so we use `node-cron` in-process as
 * the timer source and publish to Kafka when each cron fires.
 *
 * Leader election is enforced at the application layer (the
 * scheduler service owns leader election via Redis SET NX PX) so
 * only one replica has a live NodeCronScheduler at a time.
 *
 * Compared to BullMQ's repeatable jobs this has one tradeoff:
 * schedule state lives in-process, not in a shared store, so a
 * leader failover loses the current cron expressions until the
 * new leader re-reconciles from Postgres. The scheduler's
 * `scheduleLoop` already does this every 15 seconds so the
 * window is small and self-healing.
 */
export class KafkaScheduler implements RepeatingJobScheduler {
  private readonly schedules = new Map<
    string,
    { task: ScheduledTask; cronExpr: string; topic: string; tenantId: string; payload: unknown }
  >();

  constructor(private readonly bus: KafkaEventBus) {}

  async upsertSchedule(opts: {
    key: string;
    topic: string;
    cron: string;
    payload: unknown;
    tenantId: string;
  }): Promise<void> {
    const existing = this.schedules.get(opts.key);
    if (existing) {
      existing.task.stop();
      this.schedules.delete(opts.key);
    }
    if (!cron.validate(opts.cron)) {
      throw new Error(`Invalid cron expression '${opts.cron}' for key ${opts.key}`);
    }
    const task = cron.schedule(opts.cron, () => {
      void this.fire(opts);
    });
    this.schedules.set(opts.key, {
      task,
      cronExpr: opts.cron,
      topic: opts.topic,
      tenantId: opts.tenantId,
      payload: opts.payload,
    });
    task.start();
  }

  private async fire(opts: {
    key: string;
    topic: string;
    payload: unknown;
    tenantId: string;
  }): Promise<void> {
    try {
      const env = envelope(MessageTypes.CheckScheduled, opts.payload, {
        tenantId: opts.tenantId,
      });
      await this.bus.publish(opts.topic, env, { dedupeKey: opts.key });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[KafkaScheduler] fire failed for ${opts.key}:`, err);
    }
  }

  async removeSchedule(key: string): Promise<void> {
    const existing = this.schedules.get(key);
    if (existing) {
      existing.task.stop();
      this.schedules.delete(key);
    }
  }

  async listSchedules(): Promise<Array<{ key: string; cron: string }>> {
    return [...this.schedules.entries()].map(([key, entry]) => ({
      key,
      cron: entry.cronExpr,
    }));
  }

  async close(): Promise<void> {
    for (const entry of this.schedules.values()) {
      entry.task.stop();
    }
    this.schedules.clear();
  }
}

// Re-export Topics for convenience.
export { Topics };
