import type { Logger } from "@insightview/observability";
import type { AlertIncident, AlertRule } from "@insightview/db";
import { findChannelsByNames, markIncidentNotified } from "@insightview/db";
import type { TenantContext } from "@insightview/core";
import { channelFor } from "./channels/index.js";

/**
 * Dispatches a newly-fired incident to the channels named on its rule.
 * Channel names live in `rule.channelIds` (the schema field is named
 * `channelIds` for historical reasons; the values are channel names
 * such as "stdout", "ops-slack", etc., that match the unique
 * `(tenantId, name)` index on NotificationChannel).
 *
 * If the rule lists no channels, fall back to the "stdout" channel
 * if one exists so that incidents at least surface in service logs
 * rather than disappearing silently.
 */
export async function dispatchNotifications(
  ctx: TenantContext,
  incident: AlertIncident,
  rule: AlertRule,
  log: Logger,
): Promise<void> {
  const requested = Array.isArray(rule.channelIds) ? rule.channelIds : [];
  const lookup = requested.length > 0 ? requested : ["stdout"];
  const channels = await findChannelsByNames(ctx, lookup);
  if (channels.length === 0) {
    log.warn(
      { rule: rule.name, requested: lookup },
      "no enabled channels resolved for alert; incident not dispatched",
    );
    return;
  }
  for (const channel of channels) {
    try {
      const impl = channelFor(channel.type);
      await impl.send({
        channel,
        incident,
        ruleName: rule.name,
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
