import type { NotificationChannelImpl } from "./index.js";

export const webhookChannel: NotificationChannelImpl = {
  async send({ channel, incident, ruleName, log }) {
    const config = channel.config as {
      url?: string;
      headers?: Record<string, string>;
    };
    if (!config.url) {
      log.warn({ channel: channel.name }, "webhook channel missing url");
      return;
    }
    const res = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.headers ?? {}),
      },
      body: JSON.stringify({
        incidentId: incident.id,
        ruleName,
        severity: incident.severity,
        status: incident.status,
        payload: incident.payload,
      }),
    });
    if (!res.ok) {
      log.error(
        { status: res.status, channel: channel.name },
        "webhook notification failed",
      );
    }
  },
};
