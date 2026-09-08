import { test as setup, expect } from "@playwright/test";
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import path from "path";

const DEPLOYMENT_URL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.SMOKE_TEST_URL ||
  "http://localhost:3001";

const userAEmail = process.env.CLERK_TEST_USER_A_EMAIL;
const userBEmail = process.env.CLERK_TEST_USER_B_EMAIL;

const userAAuthFile = path.join(__dirname, ".clerk", "user-a.json");
const userBAuthFile = path.join(__dirname, ".clerk", "user-b.json");

setup.describe.configure({ mode: "serial" });

// @clerk/testing expects CLERK_PUBLISHABLE_KEY, but Next.js apps use
// NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. Alias it if not already set.
if (!process.env.CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
  process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

async function waitForClerkFrontend(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as Window & { Clerk?: { loaded?: boolean } }).Clerk?.loaded),
    undefined,
    { timeout: 30_000 },
  );
}

async function verifyAuthenticatedSession(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  label: string,
): Promise<void> {
  if (process.env.PLAYWRIGHT_DEV_SERVER === "true") {
    const clerkUserId = await page.evaluate(
      () => (window as Window & { Clerk?: { user?: { id?: string } | null } }).Clerk?.user?.id,
    );
    expect(clerkUserId, `${label} Clerk client session should be active`).toBeTruthy();
    console.log(`[Setup] ${label} authenticated: Clerk client session active`);
    return;
  }

  const resp = await context.request.get(`${DEPLOYMENT_URL}/api/studio-projects`, { timeout: 60_000 });
  expect(resp.status(), `${label} auth check: expected non-401, got ${resp.status()}`).not.toBe(401);
  console.log(`[Setup] ${label} authenticated: GET /api/studio-projects => ${resp.status()}`);
}

setup("clerk global setup", async () => {
  await clerkSetup();
});

setup("authenticate User A and save storage state", async ({ page, context }) => {
  expect(userAEmail, "CLERK_TEST_USER_A_EMAIL must be set").toBeDefined();



  // Set up the Clerk testing token before navigating, so the Development
  // instance allows passwordless sign-in via clerk.signIn().
  await setupClerkTestingToken({ page });

  await page.goto(DEPLOYMENT_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await waitForClerkFrontend(page);
  await clerk.signIn({ page, emailAddress: userAEmail! });

  await verifyAuthenticatedSession(page, context, "User A");

  await context.storageState({ path: userAAuthFile });
  console.log(`[Setup] User A storage state saved to ${userAAuthFile}`);
});

setup("authenticate User B and save storage state", async ({ page, context }) => {
  expect(userBEmail, "CLERK_TEST_USER_B_EMAIL must be set").toBeDefined();



  // Set up the Clerk testing token before navigating, so the Development
  // instance allows passwordless sign-in via clerk.signIn().
  await setupClerkTestingToken({ page });

  await page.goto(DEPLOYMENT_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await waitForClerkFrontend(page);
  await clerk.signIn({ page, emailAddress: userBEmail! });

  await verifyAuthenticatedSession(page, context, "User B");

  await context.storageState({ path: userBAuthFile });
  console.log(`[Setup] User B storage state saved to ${userBAuthFile}`);
});
