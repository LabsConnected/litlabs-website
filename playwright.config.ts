import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import path from "path";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.SMOKE_TEST_URL ??
  "http://127.0.0.1:3001";

const authDir = path.join(__dirname, "tests/playwright/.clerk");

// Check if .env.local has real Clerk credentials for integration tests
const hasRealClerk = (() => {
  if (process.env.PLAYWRIGHT_BASE_URL || process.env.SMOKE_TEST_URL) return true;
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

// Only include auth-dependent projects when credentials are available
const authProjects = (hasRealClerk && hasTestUsers) ? [
  {
    name: "auth-setup",
    testMatch: /auth\.setup\.ts/,
    use: { ...devices["Desktop Chrome"] },
  },
  {
    name: "mobile-chromium",
    testMatch: /mobile|golden/,
    use: {
      ...devices["Pixel 7"],
      storageState: path.join(authDir, "user-a.json"),
    },
    dependencies: ["auth-setup"],
  },
  {
    name: "authenticated-chromium",
    testMatch: /studio|chat|image|files|agents|billing|golden|projects|settings|profile|marketplace/,
    use: {
      ...devices["Desktop Chrome"],
      storageState: path.join(authDir, "user-a.json"),
    },
    dependencies: ["auth-setup"],
  },
  {
    name: "buyer-b",
    testMatch: /isolation|marketplace/,
    use: {
      ...devices["Desktop Chrome"],
      storageState: path.join(authDir, "user-b.json"),
    },
    dependencies: ["auth-setup"],
  },
] : [];

export default defineConfig({
  testDir: "./tests/playwright",

  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    },
  },

  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  maxFailures: process.env.CI ? 10 : undefined,

  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["junit", { outputFile: "test-results/playwright-junit.xml" }],
  ],

  // Automatically start the production server before tests when testing locally.
  // Requires `pnpm build` to have been run first.
  // Set PLAYWRIGHT_BASE_URL or SMOKE_TEST_URL to test a remote deployment instead.
  ...(process.env.PLAYWRIGHT_BASE_URL || process.env.SMOKE_TEST_URL
    ? {}
    : {
        webServer: {
          command: "pnpm start",
          url: "http://127.0.0.1:3001",
          timeout: 60_000,
          reuseExistingServer: true,
          cwd: ".",
          env: (() => {
            const env: Record<string, string> = {};
            for (const [key, value] of Object.entries(process.env)) {
              if (!key.startsWith("VERCEL") && value !== undefined) {
                env[key] = value;
              }
            }
            env.CI = "true";
            env.PLAYWRIGHT_TEST = "true";
            env.PLAYWRIGHT_AUTH_DISABLED = "true";
            env.HOSTNAME = "0.0.0.0";
            env.PORT = "3001";
            return env;
          })(),
        },
      }),

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // ── Public (signed-out) projects — always run ──
    {
      name: "public-chromium",
      testMatch: /public|routes|visual|accessibility|navigation|error-states|security|site-audit|terminal/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
      },
    },
    {
      name: "public-firefox",
      testMatch: /public-critical|routes-critical/,
      use: {
        ...devices["Desktop Firefox"],
        storageState: { cookies: [], origins: [] },
      },
    },
    {
      name: "public-webkit",
      testMatch: /public-critical|routes-critical/,
      use: {
        ...devices["Desktop Safari"],
        storageState: { cookies: [], origins: [] },
      },
    },

    // ── Authenticated projects — only when Clerk credentials are available ──
    ...authProjects,
  ],
});
