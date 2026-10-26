import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { parse as parseDotenv } from "dotenv";

/**
 * playwright.e2e.config.ts — ISOLATED E2E configuration (Checkpoint 1).
 *
 * Isolation contract:
 * - Runs only on the isolated E2E branch (ci/studio-e2e-isolated) — locally in
 *   a dedicated worktree, or in CI via the studio-e2e-isolated workflow.
 * - The Supabase project under test is `LiTTreeLabStudio_E2E` (supabase/config.toml
 *   in THIS worktree) — containers/volumes are named after that project_id and
 *   cannot share data with `LiTTreeLabStudio_Prod`.
 * - The server-under-test receives ONLY the env keys in APP_ENV_ALLOWLIST,
 *   loaded from e2e/env.e2e (untracked, filled at Checkpoint 2). The ambient
 *   process environment is NOT forwarded, so production/staging credentials
 *   cannot reach the test process even if present in the shell.
 * - Browser contexts block service workers (public/sw.js bypasses page.route)
 *   and the fixtures.ts context.route allowlist fails tests on any
 *   off-allowlist request.
 * - No PLAYWRIGHT_AUTH_DISABLED / middleware auth bypass is set here —
 *   authenticated coverage runs only through the real Clerk dev-instance
 *   fixture (tests/playwright-e2e/auth.setup.ts), which itself is gated.
 *
 * Gates (all fail-safe OFF):
 * - E2E_STACK_READY=true     → webServer spawn enabled; without it every test skips
 * - E2E_CLERK_AUTH=true      → enables the e2e-auth-setup project (real sign-in
 *                             via @clerk/testing, dev instance only)
 * - E2E_AUTH_STATE=<path>    → storageState file produced by the auth setup;
 *                             required by the e2e-authenticated project
 */

const E2E_ROOT = __dirname;
const ENV_FILE = path.join(E2E_ROOT, "e2e", "env.e2e");
const AUTH_STATE_FILE = process.env.E2E_AUTH_STATE
  ? path.resolve(E2E_ROOT, process.env.E2E_AUTH_STATE)
  : path.join(E2E_ROOT, "tests", "playwright-e2e", ".clerk", "user-e2e.json");

const STACK_READY = process.env.E2E_STACK_READY === "true";
const CLERK_AUTH_ENABLED = process.env.E2E_CLERK_AUTH === "true";
const HAS_AUTH_STATE = existsSync(AUTH_STATE_FILE);

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";

/**
 * App env keys permitted into the spawned server. Deliberately narrow:
 * anything not listed never reaches the test process. Values come from
 * e2e/env.e2e only — never from process.env — so a leaked production var in
 * the shell cannot be picked up.
 */
const APP_ENV_ALLOWLIST = [
  // App identity / URLs (loopback values only)
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_API_BASE",
  "NEXT_PUBLIC_MEDIA_BASE",
  "NEXT_PUBLIC_TERMINAL_HTTP_URL",
  "NEXT_PUBLIC_TERMINAL_WS_URL",
  // Clerk — DEV INSTANCE ONLY (pk_test_*/sk_test_*). Live keys are prohibited.
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
  "NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL",
  "NEXT_PUBLIC_CLERK_PROXY_URL",
  // Supabase — LiTTreeLabStudio_E2E local stack only (127.0.0.1:5532x)
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_JWT_SECRET",
  // Terminal/workspace backend — required by /api/studio-projects/[id]/files
  // (requireTerminalBaseUrl: TERMINAL_SERVER_INTERNAL_URL → ws-files proxy).
  // Must point at an E2E-scoped terminal-server with a scratch workspace root.
  "TERMINAL_SERVER_INTERNAL_URL",
  "TERMINAL_PUBLIC_URL",
  "TERMINAL_INTERNAL_SERVICE_KEY",
  "TERMINAL_AUTH_SECRET",
  "TERMINAL_ALLOWED_ORIGIN",
  // Internal plumbing the Studio APIs may require
  "INTERNAL_API_KEY",
  "AUTH_SECRET",
];

/** OS plumbing required for `pnpm start` to spawn on Windows/POSIX. */
const PROCESS_PLUMBING = [
  "PATH",
  "PATHEXT",
  "COMSPEC",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PNPM_HOME",
  "ProgramFiles",
  "NUMBER_OF_PROCESSORS",
];

function loadAllowlistedEnv(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  const parsed = parseDotenv(readFileSync(ENV_FILE));
  const out: Record<string, string> = {};
  for (const key of APP_ENV_ALLOWLIST) {
    const value = parsed[key];
    if (value && !value.startsWith("__")) out[key] = value;
  }
  return out;
}

function buildServerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PROCESS_PLUMBING) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  Object.assign(env, loadAllowlistedEnv());
  env.NODE_ENV = "production";
  env.CI = "true";
  env.PLAYWRIGHT_TEST = "true";
  env.HOSTNAME = "127.0.0.1";
  env.PORT = "3001";
  // Explicitly NOT set: PLAYWRIGHT_AUTH_DISABLED (no auth bypass),
  // VERCEL_*, STRIPE_*, provider API keys, webhooks, DB passwords.
  return env;
}

export default defineConfig({
  testDir: "./tests/playwright-e2e",
  outputDir: "test-results-e2e",

  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,

  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-e2e" }],
    ["junit", { outputFile: "test-results-e2e/playwright-junit.xml" }],
  ],

  // Spawn the production server only when the isolated stack is declared
  // ready. Without E2E_STACK_READY no server starts and every spec skips.
  ...(STACK_READY
    ? {
        webServer: {
          command: "pnpm start",
          url: baseURL,
          timeout: 120_000,
          reuseExistingServer: false,
          cwd: E2E_ROOT,
          env: buildServerEnv(),
        },
      }
    : {}),

  use: {
    baseURL,
    // public/sw.js registers on marketing routes; SW-initiated fetches bypass
    // page.route, so workers are blocked outright for isolation.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // Anonymous contexts — verify auth gating + network isolation without
    // any session. Always safe once the stack is up.
    {
      name: "e2e-anonymous",
      testMatch: /studio-canvas-builder\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
      },
    },
    // Real Clerk dev-instance sign-in via @clerk/testing. Disabled unless
    // E2E_CLERK_AUTH=true; produces the storage state the authed project uses.
    ...(CLERK_AUTH_ENABLED
      ? [
          {
            name: "e2e-auth-setup",
            testMatch: /auth\.setup\.ts/,
            use: { ...devices["Desktop Chrome"] },
          },
          {
            name: "e2e-authenticated",
            testMatch: /studio-canvas-builder\.spec\.ts/,
            dependencies: ["e2e-auth-setup"],
            use: {
              ...devices["Desktop Chrome"],
              storageState: HAS_AUTH_STATE
                ? AUTH_STATE_FILE
                : { cookies: [], origins: [] },
            },
          },
        ]
      : []),
  ],
});
