-- CreateEnum
CREATE TYPE "CheckType" AS ENUM ('BROWSER', 'API', 'TCP');

-- CreateEnum
CREATE TYPE "CheckRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'TIMEOUT', 'ERROR');

-- CreateEnum
CREATE TYPE "TriggerSource" AS ENUM ('SCHEDULE', 'MANUAL', 'API', 'ACTION');

-- CreateEnum
CREATE TYPE "AlertStrategy" AS ENUM ('THRESHOLD', 'CONSECUTIVE_FAILURES', 'COMPOSITE');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('FIRING', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "NotificationChannelType" AS ENUM ('SLACK_WEBHOOK', 'GENERIC_WEBHOOK', 'STDOUT');

-- CreateEnum
CREATE TYPE "RumEventType" AS ENUM ('WEB_VITAL', 'ERROR', 'RESOURCE', 'NAVIGATION', 'CUSTOM');

-- CreateTable
CREATE TABLE "Check" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "CheckType" NOT NULL DEFAULT 'BROWSER',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "locations" TEXT[] DEFAULT ARRAY['local']::TEXT[],
    "scriptRef" TEXT,
    "assertions" JSONB NOT NULL DEFAULT '[]',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceYaml" TEXT,
    "sourceYamlHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "checkId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "CheckRunStatus" NOT NULL DEFAULT 'QUEUED',
    "triggeredBy" "TriggerSource" NOT NULL DEFAULT 'SCHEDULE',
    "runnerId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "runId" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "webVitals" JSONB NOT NULL DEFAULT '{}',
    "resourceStats" JSONB NOT NULL DEFAULT '{}',
    "navigationStats" JSONB NOT NULL DEFAULT '{}',
    "assertionsPassed" INTEGER NOT NULL DEFAULT 0,
    "assertionsFailed" INTEGER NOT NULL DEFAULT 0,
    "traceS3Key" TEXT,
    "screenshotS3Key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "checkId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "strategy" "AlertStrategy" NOT NULL,
    "expression" JSONB NOT NULL DEFAULT '{}',
    "severity" "Severity" NOT NULL DEFAULT 'WARNING',
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 300,
    "channelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertIncident" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "ruleId" TEXT NOT NULL,
    "checkId" TEXT,
    "runId" TEXT,
    "status" "IncidentStatus" NOT NULL DEFAULT 'FIRING',
    "severity" "Severity" NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "lastNotifiedAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "AlertIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "type" "NotificationChannelType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RumSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "siteId" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "country" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "deviceCategory" TEXT,

    CONSTRAINT "RumSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RumEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "sessionId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "type" "RumEventType" NOT NULL,
    "name" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "rating" TEXT,
    "url" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attributes" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "RumEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchdogHeartbeat" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "lastBeatAt" TIMESTAMP(3) NOT NULL,
    "expectedIntervalSeconds" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "WatchdogHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorDeployment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "actor" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "yamlHash" TEXT NOT NULL,
    "diff" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Check_tenantId_enabled_idx" ON "Check"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Check_tenantId_name_key" ON "Check"("tenantId", "name");

-- CreateIndex
CREATE INDEX "CheckRun_tenantId_checkId_scheduledAt_idx" ON "CheckRun"("tenantId", "checkId", "scheduledAt");

-- CreateIndex
CREATE INDEX "CheckRun_status_scheduledAt_idx" ON "CheckRun"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "CheckResult_tenantId_runId_idx" ON "CheckResult"("tenantId", "runId");

-- CreateIndex
CREATE INDEX "CheckResult_tenantId_createdAt_idx" ON "CheckResult"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertRule_tenantId_enabled_idx" ON "AlertRule"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AlertRule_tenantId_name_key" ON "AlertRule"("tenantId", "name");

-- CreateIndex
CREATE INDEX "AlertIncident_tenantId_status_idx" ON "AlertIncident"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AlertIncident_tenantId_ruleId_idx" ON "AlertIncident"("tenantId", "ruleId");

-- CreateIndex
CREATE INDEX "AlertIncident_dedupeKey_status_idx" ON "AlertIncident"("dedupeKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannel_tenantId_name_key" ON "NotificationChannel"("tenantId", "name");

-- CreateIndex
CREATE INDEX "RumSession_tenantId_siteId_startedAt_idx" ON "RumSession"("tenantId", "siteId", "startedAt");

-- CreateIndex
CREATE INDEX "RumEvent_tenantId_siteId_type_receivedAt_idx" ON "RumEvent"("tenantId", "siteId", "type", "receivedAt");

-- CreateIndex
CREATE INDEX "RumEvent_sessionId_idx" ON "RumEvent"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchdogHeartbeat_scope_key" ON "WatchdogHeartbeat"("scope");

-- CreateIndex
CREATE INDEX "MonitorDeployment_tenantId_createdAt_idx" ON "MonitorDeployment"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "CheckRun" ADD CONSTRAINT "CheckRun_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckResult" ADD CONSTRAINT "CheckResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CheckRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertIncident" ADD CONSTRAINT "AlertIncident_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertIncident" ADD CONSTRAINT "AlertIncident_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CheckRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RumEvent" ADD CONSTRAINT "RumEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RumSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

