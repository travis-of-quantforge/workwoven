import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const fixtureEmail =
  process.env.ADMIN_TEST_EMAIL ||
  `workspace-e2e-admin-${randomUUID()}@example.test`;
process.env.ADMIN_TEST_EMAIL = fixtureEmail;

export default defineConfig({
  outputDir: "test-results/admin",
  testDir: "./tests/integration",
  testMatch: "admin.spec.ts",
  workers: 1,
  retries: 0,
  expect: { timeout: 20000 },
  timeout: 180000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3200",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3200",
    url: "http://127.0.0.1:3200",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      AI_ENABLED: "false",
      BREVO_API_KEY: "",
      ADMIN_EMAILS: fixtureEmail,
      NEXT_DIST_DIR: ".next-integration",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3200",
    },
  },
});
