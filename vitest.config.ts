import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Find every .spec.ts file across the monorepo.
    include: [
      "packages/**/src/**/*.spec.ts",
      "packages/**/__tests__/**/*.spec.ts",
      "apps/**/src/**/*.spec.ts",
      "apps/**/__tests__/**/*.spec.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "apps/dashboard/**",
      "apps/runner/src/legacy/**",
      "infra/**",
    ],
    // Unit tests run in Node without touching real DBs / Playwright.
    environment: "node",
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
