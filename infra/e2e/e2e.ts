/**
 * End-to-end platform test. Assumes the docker-compose stack is already
 * running (pnpm e2e:up) and exercises every layer:
 *
 *   1. Wait for /healthz on the API
 *   2. Deploy monitors-as-code YAML
 *   3. Trigger a synthetic run and wait for it to reach terminal state
 *   4. Assert the run result persisted (via REST)
 *   5. Assert the Pushgateway received synthetic_monitoring_* metrics
 *   6. Assert MinIO received at least one screenshot artifact
 *   7. Drive the test-site with a real browser to fire RUM events
 *   8. Assert the RUM collector persisted web vital + navigation events
 *   9. Trigger a failing run against a bad URL
 *  10. Assert an alert incident was opened
 */

import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const API = process.env.API_URL ?? "http://localhost:4000";
const PUSHGATEWAY = process.env.PUSHGATEWAY_URL ?? "http://localhost:9091";
const TEST_SITE = process.env.TEST_SITE_URL ?? "http://localhost:8080";
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";

const log = (msg: string, data?: unknown) => {
  if (data !== undefined) console.log(`[e2e] ${msg}`, data);
  else console.log(`[e2e] ${msg}`);
};

const fail = (msg: string): never => {
  console.error(`[e2e] FAIL: ${msg}`);
  process.exit(1);
};

async function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(url: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        log(`ready: ${url}`);
        return;
      }
    } catch {
      /* keep polling */
    }
    await wait(1000);
  }
  fail(`timeout waiting for ${url}`);
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    fail(`POST ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    const text = await res.text();
    fail(`GET ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

interface RunResult {
  id: string;
  status: string;
  completedAt?: string;
}

async function triggerAndWait(
  checkName: string,
  expected: string[],
  timeoutMs = 90_000,
): Promise<RunResult> {
  log(`triggering run for check=${checkName}`);
  const triggered = await apiPost<{ runId: string; status: string }>(
    "/v1/runs",
    { checkName, triggeredBy: "API" },
  );
  log(`run accepted`, triggered);

  const deadline = Date.now() + timeoutMs;
  let last: RunResult = { id: triggered.runId, status: triggered.status };
  while (Date.now() < deadline) {
    await wait(2000);
    last = await apiGet<RunResult>(`/v1/runs/${triggered.runId}`);
    if (["PASSED", "FAILED", "ERROR", "TIMEOUT"].includes(last.status)) {
      log(`run ${triggered.runId} terminal`, { status: last.status });
      if (!expected.includes(last.status)) {
        fail(
          `run ${triggered.runId} status ${last.status} not in expected [${expected.join(",")}]`,
        );
      }
      return last;
    }
  }
  return fail(`run ${triggered.runId} did not terminate within ${timeoutMs}ms`);
}

async function assertPushgatewayHasMetric(metricName: string) {
  const res = await fetch(`${PUSHGATEWAY}/metrics`);
  if (!res.ok) fail(`pushgateway /metrics responded ${res.status}`);
  const text = await res.text();
  if (!text.includes(metricName)) {
    fail(`pushgateway does not contain metric ${metricName}`);
  }
  log(`pushgateway contains ${metricName}`);
}

async function assertMinioHasObjects(bucket: string) {
  const client = new S3Client({
    region: "us-east-1",
    endpoint: MINIO_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
    },
  });
  const res = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: "synthetic/" }),
  );
  const count = res.Contents?.length ?? 0;
  if (count === 0) fail(`minio bucket ${bucket} has no synthetic/ objects`);
  log(`minio bucket ${bucket} has ${count} synthetic/ objects`);
}

async function driveTestSiteWithRealBrowser() {
  log("launching browser against test-site");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(TEST_SITE, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    // Scroll to trigger CLS measurement.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(500);
    await page.click("a[href='/about.html']").catch(() => {});
    await page.waitForTimeout(1500);
    // Force a flush via visibility change.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(1500);
    await page.close();
    await context.close();
  } finally {
    await browser.close();
  }
}

async function assertRumEventsExist(siteId: string, minCount = 1) {
  const res = await apiGet<{ items: Array<{ type: string }> }>(
    `/v1/rum/events?siteId=${encodeURIComponent(siteId)}&limit=100`,
  );
  if (!res.items || res.items.length < minCount) {
    fail(`RUM events < ${minCount} (got ${res.items?.length ?? 0})`);
  }
  const types = new Set(res.items.map((e) => e.type));
  log(`RUM events landed`, { total: res.items.length, types: [...types] });
}

async function assertIncidentFired(ruleName: string) {
  for (let i = 0; i < 10; i++) {
    const res = await apiGet<{
      items: Array<{ id: string; status: string; payload?: { rule?: string } }>;
    }>(`/v1/incidents`);
    const fired = res.items.find(
      (inc) =>
        inc.status === "FIRING" &&
        typeof inc.payload?.rule === "string" &&
        inc.payload.rule.includes(ruleName),
    );
    if (fired) {
      log(`incident fired`, { id: fired.id });
      return;
    }
    await wait(1500);
  }
  fail(`no FIRING incident for rule matching ${ruleName}`);
}

async function main() {
  log(`API=${API}`);
  log(`PUSHGATEWAY=${PUSHGATEWAY}`);
  log(`TEST_SITE=${TEST_SITE}`);
  log(`MINIO=${MINIO_ENDPOINT}`);

  // 1. Health gate
  await waitForHealth(`${API}/healthz`, 120_000);
  await waitForHealth(`${TEST_SITE}/`, 60_000);
  await waitForHealth(`${PUSHGATEWAY}/-/ready`, 30_000).catch(() =>
    waitForHealth(`${PUSHGATEWAY}/metrics`, 30_000),
  );

  // 2. Deploy monitors YAML via the API (the seed already created a row,
  // but this exercises the monitors-as-code path end-to-end).
  log("deploying monitors YAML");
  const yaml = readFileSync(
    new URL("../../monitors/test-site-home.yaml", import.meta.url),
    "utf8",
  );
  const deployRes = await apiPost<{
    appliedChecks: string[];
    appliedRules: string[];
  }>("/v1/monitors/apply", { yaml, actor: "e2e", source: "CLI" });
  log("deploy result", deployRes);
  if (!deployRes.appliedChecks.includes("test-site-home")) {
    fail(`deploy did not apply test-site-home`);
  }

  // 3-4. Trigger a passing run.
  await triggerAndWait("test-site-home", ["PASSED"], 90_000);

  // 5. Pushgateway metric check.
  await assertPushgatewayHasMetric("synthetic_monitoring_status");

  // 6. Minio artifact check.
  await assertMinioHasObjects("insightview-artifacts");

  // 7-8. Drive the test site with a real browser; assert RUM events land.
  await driveTestSiteWithRealBrowser();
  // Give the collector a beat to persist.
  await wait(3000);
  await assertRumEventsExist("test-site-home", 1);

  // 9. Create a check that is guaranteed to fail, then trigger a run.
  log("deploying guaranteed-fail check");
  const failYaml = `apiVersion: insightview.io/v1
kind: Check
metadata:
  name: e2e-broken
spec:
  type: browser
  schedule: "*/5 * * * *"
  targetUrl: "http://test-site:80/does-not-exist-${Date.now()}"
  timeoutMs: 20000
  scriptRef: basic-homepage
  assertions:
    - type: status
      value: passed
---
apiVersion: insightview.io/v1
kind: AlertRule
metadata:
  name: e2e-broken-fail
spec:
  checkName: e2e-broken
  strategy: CONSECUTIVE_FAILURES
  expression:
    threshold: 1
  severity: CRITICAL
  channels:
    - stdout
`;
  await apiPost<unknown>("/v1/monitors/apply", {
    yaml: failYaml,
    actor: "e2e",
    source: "CLI",
  });
  await triggerAndWait("e2e-broken", ["FAILED", "ERROR"], 90_000);

  // 10. Alert should fire.
  await assertIncidentFired("e2e-broken-fail");

  log("SUCCESS: end-to-end platform test passed");
}

main().catch((err) => {
  console.error("[e2e] unexpected error:", err);
  process.exit(1);
});
