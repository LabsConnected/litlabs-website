import { defineConfig, devices } from "@playwright/test";

/**
 * Live acceptance config — drives the REMOTE dev server on the PC
 * (E:\LiTT\Worktrees\dev) through the localhost SSH tunnel.
 * No webServer: the server-under-test is already running.
 */
export default defineConfig({
  testDir: __dirname,
  testMatch: /(studio-live|cancel-repro)\.spec\.ts/,
  timeout: 30 * 60_000, // CPU inference is slow — whole-file budget
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "results.json" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.LIVE_BASE_URL ?? "http://localhost:3001",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 120_000,
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
