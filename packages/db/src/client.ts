import { PrismaClient } from "./generated/client/index.js";

/**
 * Singleton Prisma client. Required to avoid connection explosions under
 * hot reload and test harnesses. Services import `prisma` from here.
 */

declare global {
  // eslint-disable-next-line no-var
  var __insightview_prisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "production"
        ? ["error", "warn"]
        : ["error", "warn"],
  });
}

export const prisma: PrismaClient =
  globalThis.__insightview_prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__insightview_prisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
