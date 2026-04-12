import type { NotificationChannelImpl } from "./index.js";

export const slackChannel: NotificationChannelImpl = {
  async send({ channel, incident, ruleName, log }) {
    const config = channel.config as { webhookUrl?: string };
    if (!config.webhookUrl) {
      log.warn({ channel: channel.name }, "slack channel missing webhookUrl");
      return;
    }
    const body = {
      text: `:rotating_light: *${incident.severity}*: ${ruleName}`,
      attachments: [
        {
          color: incident.severity === "CRITICAL" ? "danger" : "warning",
          fields: [
            { title: "Incident", value: incident.id, short: true },
            { title: "Status", value: incident.status, short: true },
          ],
        },
      ],
    };
    const res = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      log.error(
        { status: res.status, channel: channel.name },
        "slack notification failed",
      );
    }
  },
};
