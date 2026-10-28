import { defineConfig, devices } from "@playwright/test";

// Minimal config for the shared-brain acceptance spec. The main
// playwright.config.ts cannot run it: its projects either don't match the
// filename, or collect other specs whose helpers.ts imports break
// collection. This config isolates the spec + its auth-setup dependency.
export default defineConfig({
  testDir: "./tests/playwright",
  reporter: "line",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3011",
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "auth-setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "shared-brain", testMatch: /shared-brain-memory\.spec\.ts/, use: { ...devices["Desktop Chrome"] }, dependencies: ["auth-setup"] },
  ],
});
