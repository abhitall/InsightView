import { z } from "zod";

/**
 * The canonical beacon payload. Shared between the SDK (which emits)
 * and the rum-collector (which validates + ingests).
 */
export const rumEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["WEB_VITAL", "ERROR", "RESOURCE", "NAVIGATION", "CUSTOM"]),
  name: z.string().min(1),
  value: z.number().optional(),
  rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
  url: z.string().min(1),
  occurredAt: z.string(),
  attributes: z.record(z.unknown()).optional(),
});

export const rumEventBatchSchema = z.object({
  siteId: z.string().min(1),
  sessionId: z.string().min(1),
  sdkVersion: z.string(),
  sentAt: z.string(),
  page: z.object({
    url: z.string(),
    referrer: z.string().optional(),
    title: z.string().optional(),
    viewport: z
      .object({ width: z.number(), height: z.number() })
      .optional(),
  }),
  user: z
    .object({
      id: z.string().optional(),
      traits: z.record(z.string()).optional(),
    })
    .optional(),
  release: z.string().optional(),
  environment: z.string().optional(),
  events: z.array(rumEventSchema).min(1).max(200),
});

export type RumEventBatch = z.infer<typeof rumEventBatchSchema>;
export type RumEventPayload = z.infer<typeof rumEventSchema>;
