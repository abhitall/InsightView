import { Queue, Worker, type WorkerOptions } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import type { Envelope } from "@insightview/core";
import type {
  EventBus,
  Handler,
  PublishOptions,
  SubscribeOptions,
  Subscription,
} from "../types.js";

export interface BullMqEventBusConfig {
  redisUrl: string;
  keyPrefix?: string;
}

/**
 * BullMQ-backed EventBus. One Queue per topic, shared IORedis connection.
 * Workers are managed by `subscribe()` and kept in memory so they can be
 * closed together in `close()`.
 */
export class BullMqEventBus implements EventBus {
  private readonly connection: Redis;
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Set<Worker>();
  private readonly keyPrefix: string;

  constructor(config: BullMqEventBusConfig) {
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

  async publish<T>(
    topic: string,
    msg: Envelope<T>,
    opts: PublishOptions = {},
  ): Promise<void> {
    const queue = this.getQueue(topic);
    await queue.add(msg.type, msg, {
      jobId: opts.dedupeKey ?? msg.id,
      delay: opts.delayMs,
      removeOnComplete: { count: 1000, age: 24 * 3600 },
      removeOnFail: { count: 500, age: 24 * 3600 * 7 },
    });
  }

  async subscribe<T>(
    topic: string,
    handler: Handler<T>,
    opts: SubscribeOptions = {},
  ): Promise<Subscription> {
    const workerOpts: WorkerOptions = {
      connection: this.connection.duplicate(),
      prefix: this.keyPrefix,
      concurrency: opts.concurrency ?? 1,
    };
    const worker = new Worker(
      topic,
      async (job) => {
        const envelope = job.data as Envelope<T>;
        await handler(envelope);
      },
      workerOpts,
    );
    this.workers.add(worker);
    return {
      close: async () => {
        await worker.close();
        this.workers.delete(worker);
      },
    };
  }

  async healthcheck(): Promise<{ ok: boolean; backend: string }> {
    try {
      const pong = await this.connection.ping();
      return { ok: pong === "PONG", backend: "bullmq" };
    } catch {
      return { ok: false, backend: "bullmq" };
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.workers].map((w) => w.close()));
    this.workers.clear();
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
    await this.connection.quit();
  }
}
