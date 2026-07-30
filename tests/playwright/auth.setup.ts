import { test as setup, expect } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import path from "path";

const DEPLOYMENT_URL = process.env.SMOKE_TEST_URL || "http://localhost:3000";
const VERCEL_BYPASS_SECRET = process.env.VERCEL_PROTECTION_BYPASS_SECRET;
const isVercelPreview = !!VERCEL_BYPASS_SECRET;

function bypassHeaders(): Record<string, string> {
  return isVercelPreview && VERCEL_BYPASS_SECRET
    ? { "x-vercel-protection-bypass": VERCEL_BYPASS_SECRET }
    : {};
}

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

setup("clerk global setup", async () => {
  await clerkSetup();
});

setup("authenticate User A and save storage state", async ({ page, context }) => {
  expect(userAEmail, "CLERK_TEST_USER_A_EMAIL must be set").toBeDefined();

  // Set bypass header on ALL requests (including page navigation) so Vercel
  // SSO protection doesn't intercept the Clerk sign-in flow.
  if (isVercelPreview && VERCEL_BYPASS_SECRET) {
    context.setExtraHTTPHeaders({ "x-vercel-protection-bypass": VERCEL_BYPASS_SECRET });
  }

  await page.goto(DEPLOYMENT_URL);
  await clerk.signIn({ page, emailAddress: userAEmail! });

  // Verify server-side auth by hitting a protected API endpoint
  const resp = await context.request.get(`${DEPLOYMENT_URL}/api/studio-projects`, {
    headers: bypassHeaders(),
  });
  expect(resp.status(), `User A auth check: expected non-401, got ${resp.status()}`).not.toBe(401);
  console.log(`[Setup] User A authenticated: GET /api/studio-projects => ${resp.status()}`);

  await context.storageState({ path: userAAuthFile });
  console.log(`[Setup] User A storage state saved to ${userAAuthFile}`);
});

setup("authenticate User B and save storage state", async ({ page, context }) => {
  expect(userBEmail, "CLERK_TEST_USER_B_EMAIL must be set").toBeDefined();

  // Set bypass header on ALL requests (including page navigation) so Vercel
  // SSO protection doesn't intercept the Clerk sign-in flow.
  if (isVercelPreview && VERCEL_BYPASS_SECRET) {
    context.setExtraHTTPHeaders({ "x-vercel-protection-bypass": VERCEL_BYPASS_SECRET });
  }

  await page.goto(DEPLOYMENT_URL);
  await clerk.signIn({ page, emailAddress: userBEmail! });

  // Verify server-side auth by hitting a protected API endpoint
  const resp = await context.request.get(`${DEPLOYMENT_URL}/api/studio-projects`, {
    headers: bypassHeaders(),
  });
  expect(resp.status(), `User B auth check: expected non-401, got ${resp.status()}`).not.toBe(401);
  console.log(`[Setup] User B authenticated: GET /api/studio-projects => ${resp.status()}`);

  await context.storageState({ path: userBAuthFile });
  console.log(`[Setup] User B storage state saved to ${userBAuthFile}`);
});
