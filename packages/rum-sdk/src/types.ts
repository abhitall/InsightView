export type RumEventType =
  | "WEB_VITAL"
  | "ERROR"
  | "RESOURCE"
  | "NAVIGATION"
  | "CUSTOM";

export interface RumEventInput {
  id: string;
  type: RumEventType;
  name: string;
  value?: number;
  rating?: "good" | "needs-improvement" | "poor";
  url: string;
  occurredAt: string;
  attributes?: Record<string, unknown>;
}
