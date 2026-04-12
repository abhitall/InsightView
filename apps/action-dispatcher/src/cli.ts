#!/usr/bin/env node
/**
 * InsightView GitHub Action dispatcher CLI. Five subcommands, each a
 * thin wrapper over the platform REST API:
 *
 *   insightview run        - trigger a one-off run (blocks until terminal)
 *   insightview deploy     - apply monitors-as-code YAML files
 *   insightview validate   - lint YAMLs without a server
 *   insightview status     - query the current status of a check
 *   insightview legacy-run - backwards-compatible Playwright run
 *
 * The command name is passed via argv[2] so the same bin covers all paths.
 */

import { runCommand } from "./commands/run.js";
import { deployCommand } from "./commands/deploy.js";
import { validateCommand } from "./commands/validate.js";
import { statusCommand } from "./commands/status.js";
import { legacyRunCommand } from "./commands/legacyRun.js";

const commands: Record<string, (args: string[]) => Promise<number>> = {
  run: runCommand,
  deploy: deployCommand,
  validate: validateCommand,
  status: statusCommand,
  "legacy-run": legacyRunCommand,
};

async function main() {
  const command = process.argv[2];
  const rest = process.argv.slice(3);
  if (!command || !commands[command]) {
    console.error(
      `Usage: insightview <run|deploy|validate|status|legacy-run> [args]`,
    );
    process.exit(1);
  }
  const exitCode = await commands[command](rest);
  process.exit(exitCode ?? 0);
}

main().catch((err) => {
  console.error("insightview CLI failed:", err);
  process.exit(1);
});
