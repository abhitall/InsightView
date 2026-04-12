import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { envelope, MessageTypes } from "@insightview/core";
import type { RepeatingJobScheduler } from "../types.js";

export interface BullMqSchedulerConfig {
  redisUrl: string;
  keyPrefix?: string;
}

/**
 * Cron handling lives here, intentionally separate from the EventBus
 * interface. When we migrate to Kafka, this will be swapped for a
 * node-cron-backed implementation that publishes to Kafka — and the
 * consumers in each service won't change at all.
 */
export class BullMqScheduler implements RepeatingJobScheduler {
  private readonly connection: Redis;
  private readonly queues = new Map<string, Queue>();
  private readonly keyPrefix: string;

  constructor(config: BullMqSchedulerConfig) {
    this.keyPrefix = config.keyPrefix ?? "insightview";
    this.connection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }

  private getQueue(topic: string): Queue {
    let q = this.queues.get(topic);
    if (!q) {
      q = new Queue(topic, {
        connection: this.connection,
        prefix: this.keyPrefix,
      });
      this.queues.set(topic, q);
    }
    return q;
  }

  async upsertSchedule(opts: {
    key: string;
    topic: string;
    cron: string;
    payload: unknown;
    tenantId: string;
  }): Promise<void> {
    const queue = this.getQueue(opts.topic);
    // Remove any existing repeatable with the same key so updates take effect.
    const repeatables = await queue.getRepeatableJobs();
    for (const r of repeatables) {
      if (r.id === opts.key) {
        await queue.removeRepeatableByKey(r.key);
      }
    }
    const env = envelope(MessageTypes.CheckScheduled, opts.payload, {
      tenantId: opts.tenantId,
    });
    await queue.add(env.type, env, {
      repeat: { pattern: opts.cron },
      jobId: opts.key,
      removeOnComplete: { count: 1000, age: 3600 * 24 },
      removeOnFail: { count: 500, age: 3600 * 24 * 7 },
    });
  }

  async removeSchedule(key: string): Promise<void> {
    for (const queue of this.queues.values()) {
      const repeatables = await queue.getRepeatableJobs();
      for (const r of repeatables) {
        if (r.id === key) {
          await queue.removeRepeatableByKey(r.key);
        }
      }
    }
  }

  async listSchedules(): Promise<Array<{ key: string; cron: string }>> {
    const all: Array<{ key: string; cron: string }> = [];
    for (const queue of this.queues.values()) {
      const repeatables = await queue.getRepeatableJobs();
      for (const r of repeatables) {
        all.push({ key: r.id ?? r.key, cron: r.pattern ?? "" });
      }
    }
    return all;
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
    await this.connection.quit();
  }
}
