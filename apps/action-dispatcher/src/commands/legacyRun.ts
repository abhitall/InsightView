import { spawnSync } from "node:child_process";

/**
 * Backwards-compatible Playwright path. Shells out to the legacy runner
 * package's test script, which uses the original `monitoring()` fixture
 * and Prometheus Pushgateway + S3 ZIP uploader. Existing users who adopt
 * v2 without any platform can keep their GitHub Action workflow working
 * by setting `command: legacy-run`.
 */
export async function legacyRunCommand(_args: string[]): Promise<number> {
  const testUrl = process.env.TEST_URL;
  if (!testUrl) {
    console.error("TEST_URL is required for 'legacy-run'");
    return 1;
  }
  console.log(`Legacy run against ${testUrl}`);
  const res = spawnSync(
    "pnpm",
    ["--filter", "@insightview/runner", "run", "legacy:test"],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  return res.status ?? 1;
}
