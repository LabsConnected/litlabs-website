import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "fs";

const DEPLOYMENT_URL = process.env.SMOKE_TEST_URL || "http://localhost:3000";

// Check if .env.local has real Clerk credentials for integration tests
const hasRealClerk = (() => {
  if (process.env.SMOKE_TEST_URL) return true; // External server with real env
  if (!existsSync(".env.local")) return false;
  const content = readFileSync(".env.local", "utf-8");
  return (
    content.includes("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=") &&
    content.includes("CLERK_SECRET_KEY=") &&
    !content.includes('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""') &&
    !content.includes('CLERK_SECRET_KEY=""')
  );
})();

const hasTestUsers = !!(
  process.env.CLERK_TEST_USER_A_EMAIL &&
  process.env.CLERK_TEST_USER_B_EMAIL
);

export default defineConfig({
  testDir: "./tests/playwright",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  // Automatically start the production server before tests.
  // Requires `pnpm build` to have been run first.
  // Set SMOKE_TEST_URL to test a remote deployment instead.
  ...(process.env.SMOKE_TEST_URL
    ? {}
    : {
        webServer: {
          command: "pnpm start",
          url: "http://localhost:3000",
          timeout: 60_000,
          reuseExistingServer: false,
          cwd: ".",
          env: (() => {
            // Strip VERCEL env vars so test bypass is valid
            const env: Record<string, string> = {};
            for (const [key, value] of Object.entries(process.env)) {
              if (!key.startsWith("VERCEL") && value !== undefined) {
                env[key] = value;
              }
            }
            env.CI = "true";
            env.PLAYWRIGHT_TEST = "true";
            return env;
          })(),
        },
      }),

  use: {
    baseURL: DEPLOYMENT_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "credential-free",
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Clerk authenticated setup — runs before integration tests
    ...(hasRealClerk && hasTestUsers
      ? [
          {
            name: "clerk-setup",
            testMatch: /auth\.setup\.ts/,
            use: { ...devices["Desktop Chrome"] },
          },
        ]
      : []),
    // Integration tests — depends on clerk-setup for auth state files
    ...(hasRealClerk && hasTestUsers
      ? [
          {
            name: "preview-integration",
            testMatch: /integration\.spec\.ts/,
            dependencies: ["clerk-setup"],
            use: {
              ...devices["Desktop Chrome"],
            },
          },
        ]
      : hasRealClerk
        ? [
            {
              name: "preview-integration",
              testMatch: /integration\.spec\.ts/,
              use: {
                ...devices["Desktop Chrome"],
              },
            },
          ]
        : []),
  ],
});
