import { BullMqEventBus } from "./bullmq/BullMqEventBus.js";
import { BullMqScheduler } from "./bullmq/BullMqScheduler.js";
import type { EventBus, RepeatingJobScheduler } from "./types.js";

export interface BusFactoryConfig {
  redisUrl?: string;
  backend?: "bullmq";
}

export function createEventBus(config: BusFactoryConfig = {}): EventBus {
  const redisUrl = config.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  return new BullMqEventBus({ redisUrl });
}

export function createScheduler(
  config: BusFactoryConfig = {},
): RepeatingJobScheduler {
  const redisUrl = config.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  return new BullMqScheduler({ redisUrl });
}
