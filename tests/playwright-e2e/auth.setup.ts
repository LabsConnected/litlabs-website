import { test as setup, expect } from "@playwright/test";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import path from "path";

/**
 * E2E auth setup — real Clerk DEVELOPMENT-instance sign-in via @clerk/testing.
 *
 * This file is an explicit unresolved gate, not a fabricated session:
 * - It only runs when the `e2e-auth-setup` project is enabled, which requires
 *   E2E_CLERK_AUTH=true (see playwright.e2e.config.ts).
 * - It performs a real sign-in: clerkSetup mints a testing token from the dev
 *   instance and clerk.signIn creates a genuine sign-in ticket via the Clerk
 *   Backend API (CLERK_SECRET_KEY, dev instance only).
 * - Required env (loaded by the runner, documented in e2e/env.e2e.example):
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (pk_test_*), CLERK_SECRET_KEY (sk_test_*),
 *   CLERK_TEST_USER_E2E_EMAIL — a dedicated disposable user in the dev instance.
 * - Storage state is written ONLY to tests/playwright-e2e/.clerk/user-e2e.json.
 *   The existing tests/playwright/.clerk/user-*.json files are never touched.
 */

const DEPLOYMENT_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const userEmail = process.env.CLERK_TEST_USER_E2E_EMAIL;
const userAuthFile = path.join(__dirname, ".clerk", "user-e2e.json");

// @clerk/testing expects CLERK_PUBLISHABLE_KEY; the app uses the NEXT_PUBLIC_ name.
if (!process.env.CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
  process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

setup("clerk global setup (dev instance)", async () => {
  expect(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY,
    "Clerk dev publishable key must be provided via e2e/env.e2e",
  ).toBeTruthy();
  expect(
    process.env.CLERK_SECRET_KEY,
    "Clerk dev secret key (sk_test_*) must be provided via e2e/env.e2e",
  ).toMatch(/^sk_test_/);
  await clerkSetup();
});

setup("authenticate E2E user and save storage state", async ({ page, context }) => {
  expect(
    userEmail,
    "CLERK_TEST_USER_E2E_EMAIL must be set — a dedicated disposable user in the Clerk dev instance",
  ).toBeDefined();

  await setupClerkTestingToken({ page });
  await page.goto(DEPLOYMENT_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForFunction(
    () => Boolean((window as Window & { Clerk?: { loaded?: boolean } }).Clerk?.loaded),
    undefined,
    { timeout: 30_000 },
  );
  await clerk.signIn({ page, emailAddress: userEmail! });

  const clerkUserId = await page.evaluate(
    () => (window as Window & { Clerk?: { user?: { id?: string } | null } }).Clerk?.user?.id,
  );
  expect(clerkUserId, "Clerk client session should be active after sign-in").toBeTruthy();

  await context.storageState({ path: userAuthFile });
});
