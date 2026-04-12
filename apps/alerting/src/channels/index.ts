import type { Logger } from "@insightview/observability";
import type { AlertIncident, NotificationChannel } from "@insightview/db";
import type { NotificationChannelType } from "@insightview/core";
import { ValidationError } from "@insightview/core";
import { slackChannel } from "./SlackChannel.js";
import { webhookChannel } from "./WebhookChannel.js";
import { stdoutChannel } from "./StdoutChannel.js";

export interface NotificationContext {
  channel: NotificationChannel;
  incident: AlertIncident;
  ruleName: string;
  log: Logger;
}

export interface NotificationChannelImpl {
  send(ctx: NotificationContext): Promise<void>;
}

const registry: Record<NotificationChannelType, NotificationChannelImpl> = {
  SLACK_WEBHOOK: slackChannel,
  GENERIC_WEBHOOK: webhookChannel,
  STDOUT: stdoutChannel,
};

export function channelFor(
  type: NotificationChannelType,
): NotificationChannelImpl {
  const impl = registry[type];
  if (!impl) throw new ValidationError(`Unknown channel type '${type}'`);
  return impl;
}
