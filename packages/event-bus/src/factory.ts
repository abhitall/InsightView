import { BullMqEventBus } from "./bullmq/BullMqEventBus.js";
import { BullMqScheduler } from "./bullmq/BullMqScheduler.js";
import { KafkaEventBus } from "./kafka/KafkaEventBus.js";
import { KafkaScheduler } from "./kafka/KafkaScheduler.js";
import type { EventBus, RepeatingJobScheduler } from "./types.js";

export interface BusFactoryConfig {
  redisUrl?: string;
  kafkaBrokers?: string[];
  backend?: "bullmq" | "kafka";
}

function detectBackend(config: BusFactoryConfig): "bullmq" | "kafka" {
  if (config.backend) return config.backend;
  const envBackend = process.env.BUS_BACKEND?.toLowerCase();
  if (envBackend === "kafka" || envBackend === "bullmq") return envBackend;
  if (process.env.KAFKA_BROKERS) return "kafka";
  return "bullmq";
}

function parseBrokers(config: BusFactoryConfig): string[] {
  if (config.kafkaBrokers && config.kafkaBrokers.length > 0) {
    return config.kafkaBrokers;
  }
  const env = process.env.KAFKA_BROKERS;
  if (!env) return ["localhost:9092"];
  return env
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);
}

export function createEventBus(config: BusFactoryConfig = {}): EventBus {
  const backend = detectBackend(config);
  if (backend === "kafka") {
    return new KafkaEventBus({
      brokers: parseBrokers(config),
      clientId: process.env.KAFKA_CLIENT_ID ?? "insightview",
    });
  }
  const redisUrl =
    config.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  return new BullMqEventBus({ redisUrl });
}

export function createScheduler(
  config: BusFactoryConfig = {},
): RepeatingJobScheduler {
  const backend = detectBackend(config);
  if (backend === "kafka") {
    const brokers = parseBrokers(config);
    return new KafkaScheduler(
      new KafkaEventBus({
        brokers,
        clientId: process.env.KAFKA_CLIENT_ID ?? "insightview-scheduler",
      }),
    );
  }
  const redisUrl =
    config.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  return new BullMqScheduler({ redisUrl });
}
