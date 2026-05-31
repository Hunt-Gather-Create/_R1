import { defineConfig, devices } from "@playwright/test";

// Smoke harness for runway.startround1.com. Tests live in tests/runway/.
// Requires `PLAYWRIGHT_RUNWAY_PASSWORD` in the shell or .env.local at run time.

export default defineConfig({
  testDir: "./tests/runway",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.RUNWAY_SMOKE_BASE_URL ?? "https://runway.startround1.com",
    trace: "retain-on-failure",
    screenshot: "on",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "playwright/.auth/runway.json",
      },
      dependencies: ["setup"],
    },
  ],
});
