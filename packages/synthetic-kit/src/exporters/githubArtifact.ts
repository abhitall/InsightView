import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Exporter } from "./index.js";

/**
 * GitHub Actions artifact exporter. Writes the JSON envelope and
 * copies step artifacts into a directory that a subsequent
 * `actions/upload-artifact@v4` step can pick up. This is the
 * "no cloud required" export path — retention is 7–90 days depending
 * on the workflow's configuration.
 */
export const githubArtifactExporter: Exporter = {
  name: "github-artifact",
  async export(envelope, config) {
    const dir =
      (config.dir as string) ??
      process.env.INSIGHTVIEW_ARTIFACTS_DIR ??
      "artifacts";
    const runDir = join(dir, envelope.monitor, envelope.runId);
    mkdirSync(runDir, { recursive: true });

    writeFileSync(
      join(runDir, "result.json"),
      JSON.stringify(envelope, null, 2),
    );

    for (const step of envelope.steps) {
      if (step.screenshotPath && existsSync(step.screenshotPath)) {
        const dst = join(
          runDir,
          "steps",
          `${sanitize(step.name)}.png`,
        );
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(step.screenshotPath, dst);
      }
      if (step.tracePath && existsSync(step.tracePath)) {
        const dst = join(
          runDir,
          "steps",
          `${sanitize(step.name)}.trace.zip`,
        );
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(step.tracePath, dst);
      }
    }
  },
};

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
