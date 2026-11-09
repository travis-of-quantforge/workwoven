import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  outputDir: "test-results/integration",
  testDir: "./tests/integration",
  workers: 1,
  retries: 0,
  expect: { timeout: 20000 },
  timeout: 180000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3200",
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3200",
    url: "http://127.0.0.1:3200",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      AI_ENABLED: "false",
      BREVO_API_KEY: "",
      NEXT_DIST_DIR: ".next-integration",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3200",
    },
  },
});
