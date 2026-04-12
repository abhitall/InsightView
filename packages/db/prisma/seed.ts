/**
 * Seed script. Creates the default tenant's starter monitors, alert rules,
 * and a stdout notification channel. Deterministic and idempotent so it can
 * run on every migrate deploy.
 */

import { PrismaClient } from "../src/generated/client/index.js";

const prisma = new PrismaClient();

async function main() {
  const tenantId = "default";

  // 1. Stdout notification channel — always present, used by e2e test.
  const stdoutChannel = await prisma.notificationChannel.upsert({
    where: { tenantId_name: { tenantId, name: "stdout" } },
    create: {
      tenantId,
      name: "stdout",
      type: "STDOUT",
      config: {},
    },
    update: {},
  });

  // 2. Sample browser check pointing at the docker-compose test-site.
  const testSiteCheck = await prisma.check.upsert({
    where: { tenantId_name: { tenantId, name: "test-site-home" } },
    create: {
      tenantId,
      name: "test-site-home",
      description: "Synthetic check against the docker-compose test-site",
      type: "BROWSER",
      enabled: true,
      schedule: "*/5 * * * *",
      targetUrl: "http://test-site:80",
      timeoutMs: 45000,
      scriptRef: "basic-homepage",
      assertions: [
        { type: "status", value: "passed" },
        { type: "body-contains", value: "InsightView" },
      ],
      tags: ["seed", "e2e"],
    },
    update: {},
  });

  // 3. Alert rule: any run that doesn't PASS fires at CRITICAL severity.
  await prisma.alertRule.upsert({
    where: { tenantId_name: { tenantId, name: "test-site-home-fail" } },
    create: {
      tenantId,
      name: "test-site-home-fail",
      checkId: testSiteCheck.id,
      enabled: true,
      strategy: "CONSECUTIVE_FAILURES",
      expression: { threshold: 1 },
      severity: "CRITICAL",
      cooldownSeconds: 60,
      channelIds: [stdoutChannel.name],
    },
    update: {},
  });

  console.log("Seed completed for tenant=default");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
