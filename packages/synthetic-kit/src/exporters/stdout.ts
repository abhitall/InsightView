import type { Exporter } from "./index.js";

/**
 * Stdout exporter. Dumps the full envelope as pretty JSON. Always
 * enabled in Actions logs so every run has a visible audit trail.
 */
export const stdoutExporter: Exporter = {
  name: "stdout",
  async export(envelope) {
    process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
  },
};
