import type { NotificationChannelImpl } from "./index.js";

export const stdoutChannel: NotificationChannelImpl = {
  async send({ incident, ruleName, log }) {
    // The e2e test scans container logs for this exact prefix. Do not change
    // the format without also updating infra/e2e/helpers/dockerLogs.ts.
    const line = `[STDOUT notification] incident=${incident.id} rule=${ruleName} severity=${incident.severity} status=${incident.status}`;
    // Write both to pino and plain stdout so docker logs captures it reliably.
    process.stdout.write(line + "\n");
    log.warn({ incidentId: incident.id, ruleName }, "stdout notification sent");
  },
};
