import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  outputDir: "test-results/setup",
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:3100" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      SUPABASE_SECRET_KEY: "",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
