/**
 * Domain enums shared between services. These are mirrored in the
 * Prisma schema (`packages/db/prisma/schema.prisma`). When you add
 * a value here, add it there too.
 */

export const CheckType = {
  BROWSER: "BROWSER",
  API: "API",
  TCP: "TCP",
} as const;
export type CheckType = (typeof CheckType)[keyof typeof CheckType];

export const CheckRunStatus = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  PASSED: "PASSED",
  FAILED: "FAILED",
  TIMEOUT: "TIMEOUT",
  ERROR: "ERROR",
} as const;
export type CheckRunStatus = (typeof CheckRunStatus)[keyof typeof CheckRunStatus];

export const TriggerSource = {
  SCHEDULE: "SCHEDULE",
  MANUAL: "MANUAL",
  API: "API",
  ACTION: "ACTION",
} as const;
export type TriggerSource = (typeof TriggerSource)[keyof typeof TriggerSource];

export const AlertStrategy = {
  THRESHOLD: "THRESHOLD",
  CONSECUTIVE_FAILURES: "CONSECUTIVE_FAILURES",
  COMPOSITE: "COMPOSITE",
} as const;
export type AlertStrategy = (typeof AlertStrategy)[keyof typeof AlertStrategy];

export const Severity = {
  INFO: "INFO",
  WARNING: "WARNING",
  CRITICAL: "CRITICAL",
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export const IncidentStatus = {
  FIRING: "FIRING",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  RESOLVED: "RESOLVED",
} as const;
export type IncidentStatus = (typeof IncidentStatus)[keyof typeof IncidentStatus];

export const NotificationChannelType = {
  SLACK_WEBHOOK: "SLACK_WEBHOOK",
  GENERIC_WEBHOOK: "GENERIC_WEBHOOK",
  STDOUT: "STDOUT",
} as const;
export type NotificationChannelType =
  (typeof NotificationChannelType)[keyof typeof NotificationChannelType];

export const RumEventType = {
  WEB_VITAL: "WEB_VITAL",
  ERROR: "ERROR",
  RESOURCE: "RESOURCE",
  NAVIGATION: "NAVIGATION",
  CUSTOM: "CUSTOM",
} as const;
export type RumEventType = (typeof RumEventType)[keyof typeof RumEventType];
