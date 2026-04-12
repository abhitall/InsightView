import type { Logger } from "@insightview/observability";
import type { AlertIncident } from "@insightview/db";
import { findChannelsByNames, markIncidentNotified } from "@insightview/db";
import type { TenantContext } from "@insightview/core";
import { channelFor } from "./channels/index.js";

/**
 * Dispatches a newly-fired incident to every configured notification
 * channel. Channels are registered in ./channels/index.ts; adding a new
 * channel type is one map entry.
 */
export async function dispatchNotifications(
  ctx: TenantContext,
  incident: AlertIncident,
  log: Logger,
): Promise<void> {
  const rule = incident.payload as { rule?: string };
  const ruleName = typeof rule?.rule === "string" ? rule.rule : "alert";
  const channelIds: string[] = [];
  // For MVP, channelIds on the rule actually store names (stdout, etc.).
  // Resolve the associated NotificationChannel rows by name.
  const channels = await findChannelsByNames(ctx, ["stdout"]);
  if (channels.length === 0) {
    log.warn({ ruleName }, "no channels configured for alert");
  }
  for (const channel of channels) {
    try {
      const impl = channelFor(channel.type);
      await impl.send({
        channel,
        incident,
        ruleName,
        log,
      });
    } catch (err) {
      log.error(
        { err, channel: channel.name, type: channel.type },
        "notification send failed",
      );
    }
  }
  try {
    await markIncidentNotified(incident.id);
  } catch (err) {
    log.warn({ err }, "failed to mark incident notified");
  }
}
