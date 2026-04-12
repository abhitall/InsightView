import { buildServer } from "./server.js";
import { createLogger } from "@insightview/observability";

const log = createLogger({ service: "api" });

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port, host });
    log.info({ port, host }, "API listening");
  } catch (err) {
    log.error({ err }, "Failed to start API");
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutting down API");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error({ err }, "Fatal error during startup");
  process.exit(1);
});
