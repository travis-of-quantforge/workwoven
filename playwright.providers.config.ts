import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/providers",
  outputDir: "test-results/providers",
  workers: 1,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 20000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3300",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3300",
    url: "http://127.0.0.1:3300",
    reuseExistingServer: false,
    timeout: 90000,
    env: {
      AI_ENABLED: "true",
      NEXT_DIST_DIR: ".next-providers",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3300",
    },
  },
});
