import { Kafka, type Consumer, type Producer, logLevel } from "kafkajs";
import type { Envelope } from "@insightview/core";
import type {
  EventBus,
  Handler,
  PublishOptions,
  SubscribeOptions,
  Subscription,
} from "../types.js";

/**
 * Kafka-backed EventBus. ADR 0002's stable seam — the interface
 * has no BullMQ-isms so switching from the Redis-backed MVP to
 * Kafka is purely a factory-selection change, not a refactor.
 *
 * Design choices:
 *
 * 1. **kafkajs** is the only production-ready TypeScript client
 *    for Kafka. It does NOT support idempotent producers as a
 *    stable feature (`idempotent: true` is marked experimental
 *    in kafkajs itself) so we do NOT rely on producer idempotence
 *    — consumers MUST be idempotent at the application layer.
 *    Our runner already checks CheckRun.status before claiming
 *    work, so duplicate deliveries are already handled.
 *
 * 2. **Per-key ordering only**. Messages for the same logical
 *    resource (e.g., `tenantId/checkId`) are assigned to the same
 *    partition via the optional dedupeKey; ordering across keys
 *    is NOT guaranteed. Consumers that need cross-entity order
 *    must use an application-level aggregate.
 *
 * 3. **Consumer groups** map to the subscribe opts.group field.
 *    Multiple replicas of the same service can share a group to
 *    distribute load; two different services (e.g., alerting +
 *    dashboard) use different groups to both receive every
 *    message.
 *
 * 4. **Topic naming** is preserved from BullMQ — "checks.scheduled"
 *    etc. The Kafka admin client auto-creates topics the first
 *    time they're published to, with `numPartitions: 12` so
 *    per-key ordering has room to scale horizontally without
 *    repartitioning later.
 */
export interface KafkaEventBusConfig {
  brokers: string[];
  clientId?: string;
  numPartitions?: number;
  replicationFactor?: number;
}

const DEFAULT_PARTITIONS = 12;
const DEFAULT_REPLICATION = 1;

export class KafkaEventBus implements EventBus {
  private readonly kafka: Kafka;
  private producer: Producer | null = null;
  private readonly consumers = new Set<Consumer>();
  private readonly createdTopics = new Set<string>();
  private readonly numPartitions: number;
  private readonly replicationFactor: number;

  constructor(config: KafkaEventBusConfig) {
    this.kafka = new Kafka({
      clientId: config.clientId ?? "insightview",
      brokers: config.brokers,
      logLevel: logLevel.ERROR,
      retry: { retries: 5, initialRetryTime: 300 },
    });
    this.numPartitions = config.numPartitions ?? DEFAULT_PARTITIONS;
    this.replicationFactor = config.replicationFactor ?? DEFAULT_REPLICATION;
  }

  private async getProducer(): Promise<Producer> {
    if (this.producer) return this.producer;
    const p = this.kafka.producer({
      maxInFlightRequests: 5,
      // `idempotent: true` is experimental in kafkajs — see ADR 0010.
      // Consumers are idempotent at the application layer instead.
      retry: { retries: 5 },
    });
    await p.connect();
    this.producer = p;
    return p;
  }

  private async ensureTopic(topic: string): Promise<void> {
    if (this.createdTopics.has(topic)) return;
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      await admin
        .createTopics({
          topics: [
            {
              topic,
              numPartitions: this.numPartitions,
              replicationFactor: this.replicationFactor,
            },
          ],
          waitForLeaders: true,
        })
        .catch((err: unknown) => {
          // TOPIC_ALREADY_EXISTS is expected in most cases.
          const msg = (err as Error).message ?? "";
          if (!msg.includes("already exists")) {
            throw err;
          }
        });
      this.createdTopics.add(topic);
    } finally {
      await admin.disconnect().catch(() => {});
    }
  }

  async publish<T>(
    topic: string,
    msg: Envelope<T>,
    opts: PublishOptions = {},
  ): Promise<void> {
    await this.ensureTopic(topic);
    const producer = await this.getProducer();
    // Use the dedupe key as the Kafka partition key so the same
    // logical resource always lands in the same partition for
    // per-key ordering. Fall back to the envelope id.
    const key = opts.dedupeKey ?? msg.id;
    await producer.send({
      topic,
      messages: [
        {
          key,
          value: JSON.stringify(msg),
          headers: {
            "x-insightview-type": msg.type,
            "x-insightview-tenant": msg.tenantId,
            "x-insightview-version": String(msg.version),
            ...(msg.traceId ? { "x-insightview-trace": msg.traceId } : {}),
          },
          // `delayMs` is not natively supported by Kafka — the
          // scheduler owns cron + delay semantics via node-cron +
          // direct publish. Callers that pass delayMs get a
          // warning.
        },
      ],
    });
    if (opts.delayMs) {
      // Soft warning — the KafkaScheduler handles the cron path,
      // so nothing actually needs this at runtime.
      // eslint-disable-next-line no-console
      console.warn(
        `[KafkaEventBus] publish ignored delayMs=${opts.delayMs} (use KafkaScheduler for delayed dispatch)`,
      );
    }
  }

  async subscribe<T>(
    topic: string,
    handler: Handler<T>,
    opts: SubscribeOptions = {},
  ): Promise<Subscription> {
    await this.ensureTopic(topic);
    const groupId = opts.group ?? `insightview-${topic}`;
    const consumer = this.kafka.consumer({
      groupId,
      // Balance throughput with latency: small fetch + frequent commits.
      maxBytesPerPartition: 1024 * 1024,
      sessionTimeout: 30_000,
    });
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });
    await consumer.run({
      partitionsConsumedConcurrently: opts.concurrency ?? 1,
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        try {
          const envelope = JSON.parse(
            message.value.toString("utf8"),
          ) as Envelope<T>;
          await handler(envelope);
        } catch (err) {
          // Don't rethrow — that would block the partition. Log and
          // drop: duplicates are acceptable per ADR 0010, total loss
          // of a malformed message is also acceptable because the
          // producer side should have rejected it.
          // eslint-disable-next-line no-console
          console.error(`[KafkaEventBus] handler failed:`, err);
        }
      },
    });
    this.consumers.add(consumer);
    return {
      close: async () => {
        await consumer.disconnect();
        this.consumers.delete(consumer);
      },
    };
  }

  async healthcheck(): Promise<{ ok: boolean; backend: string }> {
    try {
      const admin = this.kafka.admin();
      await admin.connect();
      await admin.listTopics();
      await admin.disconnect();
      return { ok: true, backend: "kafka" };
    } catch {
      return { ok: false, backend: "kafka" };
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.consumers].map((c) => c.disconnect()));
    this.consumers.clear();
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }
  }
}
