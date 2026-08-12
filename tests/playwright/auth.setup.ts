import { test as setup, expect } from "@playwright/test";
import { clerkSetup, clerk } from "@clerk/testing/playwright";
import path from "path";
import { existsSync, readFileSync } from "fs";

// Load .env.local so CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY are available
// to the test process (Playwright only injects env to the webServer, not tests)
if (existsSync(".env.local")) {
  const envContent = readFileSync(".env.local", "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.substring(0, eqIdx);
    const val = trimmed.substring(eqIdx + 1).replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

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

async function authenticateUser(
  email: string,
  authFile: string,
  context: import("@playwright/test").BrowserContext,
  page: import("@playwright/test").Page,
): Promise<void> {
  if (isVercelPreview && VERCEL_BYPASS_SECRET) {
    context.setExtraHTTPHeaders({ "x-vercel-protection-bypass": VERCEL_BYPASS_SECRET });
  }

  // Navigate to a non-protected page so Clerk's JS SDK loads
  await page.goto(DEPLOYMENT_URL, { waitUntil: "domcontentloaded" });

  // Use Clerk's official testing helper — handles:
  //   1. setupClerkTestingToken (bot protection bypass)
  //   2. Waiting for window.Clerk to load
  //   3. Looking up user by email via Backend API
  //   4. Creating a sign-in token
  //   5. Signing in via ticket strategy
  //   6. Waiting for window.Clerk.user !== null
  console.log(`[Setup] Signing in ${email} via @clerk/testing`);
  await clerk.signIn({ page, emailAddress: email });

  // clerk.signIn() sets __session but NOT __client_uat.
  // The Clerk middleware requires __client_uat to verify the session.
  // Without it, the middleware redirects to the Clerk handshake flow,
  // which sets __client_uat and refreshes __session.
  // Trigger this by navigating to the homepage — the browser follows
  // the redirect chain (localhost → clerk handshake → back to localhost),
  // after which __client_uat is set in the cookie jar.
  const appUrl = new URL(DEPLOYMENT_URL);
  await page.goto(DEPLOYMENT_URL, { waitUntil: "networkidle" });
  console.log(`[Setup] Page URL after goto: ${page.url()}`);

  // If page redirected to Clerk handshake, wait for it to come back
  if (page.url().includes("clerk.")) {
    console.log(`[Setup] Page is on Clerk domain, waiting for redirect back...`);
    await page.waitForURL(DEPLOYMENT_URL + "**", { timeout: 15000 }).catch(() => {});
    console.log(`[Setup] Page URL after wait: ${page.url()}`);
  }

  // Verify Clerk set cookies naturally via the handshake flow
  const appCookies = await context.cookies(DEPLOYMENT_URL);
  const cookieNames = appCookies.map((c) => c.name);
  const hasSession = cookieNames.includes("__session");
  const hasClientUat = cookieNames.includes("__client_uat");
  console.log(`[Setup] Cookies on ${appUrl.hostname}: ${cookieNames.join(", ")}`);
  console.log(`[Setup] __session: ${hasSession}, __client_uat: ${hasClientUat}`);

  if (!hasSession) {
    throw new Error(`No __session cookie found on ${appUrl.hostname} after clerk.signIn`);
  }
  if (!hasClientUat) {
    throw new Error(
      `No __client_uat cookie after handshake. ` +
      `Cookies: ${cookieNames.join(", ")}`,
    );
  }

  // Verify server-side auth — __session JWT expires in 60s, so check immediately.
  // page.request shares cookies with the BrowserContext (Playwright docs).
  const authResp = await page.request.get(`${DEPLOYMENT_URL}/api/studio-projects`, {
    headers: bypassHeaders(),
  });
  const apiStatus = authResp.status();
  console.log(`[Setup] Auth check: GET /api/studio-projects => ${apiStatus}`);
  expect(apiStatus, `Auth check for ${email}: expected non-401, got ${apiStatus}`).not.toBe(401);

  await context.storageState({ path: authFile });
  console.log(`[Setup] Storage state saved to ${authFile}`);
}

setup("clerk global setup", async () => {
  // clerkSetup fetches a testing token from Clerk Backend API and sets
  // CLERK_TESTING_TOKEN and CLERK_FAPI environment variables.
  // This token is used by setupClerkTestingToken to bypass bot protection
  // on Frontend API requests during sign-in.
  console.log("[Setup] Running clerkSetup()...");
  await clerkSetup({ debug: process.env.CLERK_TESTING_DEBUG === "true" });
  console.log("[Setup] clerkSetup() complete");
});

setup("authenticate User A and save storage state", async ({ page, context }) => {
  expect(userAEmail, "CLERK_TEST_USER_A_EMAIL must be set").toBeDefined();
  await authenticateUser(userAEmail!, userAAuthFile, context, page);
});

setup("authenticate User B and save storage state", async ({ page, context }) => {
  expect(userBEmail, "CLERK_TEST_USER_B_EMAIL must be set").toBeDefined();
  await authenticateUser(userBEmail!, userBAuthFile, context, page);
});
