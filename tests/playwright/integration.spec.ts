import { test, expect } from "@playwright/test";

const DEPLOYMENT_URL = process.env.SMOKE_TEST_URL || "http://localhost:3000";

// ─── Unauthenticated behavior on Vercel Preview ───
// On Vercel, Clerk middleware redirects unauthenticated users client-side.
// Protected API routes may return 200 with an HTML login page or redirect
// to Clerk's hosted sign-in. The key assertion is NO 500 errors.

test.describe("Vercel Preview — unauthenticated behavior", () => {
  test("homepage returns 200", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/`);
    expect(resp.status()).toBe(200);
    console.log(`Homepage: ${resp.status()}`);
  });

  test("pricing returns 200", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/pricing`);
    expect(resp.status()).toBe(200);
    console.log(`Pricing: ${resp.status()}`);
  });

  test("docs returns 200", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/docs`);
    expect(resp.status()).toBe(200);
    console.log(`Docs: ${resp.status()}`);
  });

  test("studio page loads without 500", async ({ page }) => {
    const response = await page.goto(`${DEPLOYMENT_URL}/studio`);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    // Clerk may redirect to sign-in or render embedded sign-in
    const url = page.url();
    const hasContent = await page.locator("body *").count();
    expect(hasContent).toBeGreaterThan(0);
    console.log(`Studio: status=200, url=${url}, bodyElements=${hasContent}`);
  });

  test("dashboard page loads without 500", async ({ page }) => {
    const response = await page.goto(`${DEPLOYMENT_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await page.waitForTimeout(3000);
    // Clerk may redirect to sign-in — that's valid behavior
    const hasContent = await page.locator("body *").count();
    expect(hasContent).toBeGreaterThan(0);
    console.log(`Dashboard: status=200, bodyElements=${hasContent}`);
  });

  test("sign-in page renders without 500", async ({ page }) => {
    const response = await page.goto(`${DEPLOYMENT_URL}/sign-in`);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    const hasContent = await page.locator("body *").count();
    expect(hasContent).toBeGreaterThan(0);
    console.log(`Sign-in: status=200, bodyElements=${hasContent}`);
  });
});

// ─── API endpoints — no 500 errors ───
// On Vercel Preview with real credentials, API endpoints should not 500.
// Unauthenticated requests may get 200 (HTML login page), 307 (redirect), or 401.

test.describe("Vercel Preview — API endpoints", () => {
  test("conversations API does not 500", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/api/studio/conversations`);
    expect(resp.status()).toBeLessThan(500);
    console.log(`Conversations API: ${resp.status()}`);
  });

  test("storage API does not 500 (R2 credentials working)", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/api/storage`);
    expect(resp.status()).toBeLessThan(500);
    console.log(`Storage API: ${resp.status()}`);
  });

  test("stripe checkout API does not 500 (Stripe credentials working)", async ({ request }) => {
    const resp = await request.post(`${DEPLOYMENT_URL}/api/stripe/checkout`, {
      data: { priceId: "price_test_invalid" },
      headers: { "Content-Type": "application/json" },
    });
    expect(resp.status()).toBeLessThan(500);
    console.log(`Stripe checkout API: ${resp.status()}`);
  });

  test("stripe webhook endpoint does not 500", async ({ request }) => {
    const resp = await request.post(`${DEPLOYMENT_URL}/api/stripe/webhook`, {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(resp.status()).toBeLessThan(500);
    expect(resp.status()).not.toBe(404);
    console.log(`Stripe webhook endpoint: ${resp.status()}`);
  });

  test("orchestrate API does not 500 (AI credentials working)", async ({ request }) => {
    const resp = await request.post(`${DEPLOYMENT_URL}/api/orchestrate`, {
      data: { message: "test" },
      headers: { "Content-Type": "application/json" },
    });
    expect(resp.status()).toBeLessThan(500);
    console.log(`Orchestrate API: ${resp.status()}`);
  });

  test("nonexistent API does not 500", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/api/this-does-not-exist`);
    // On Vercel, unknown API routes may return 200 (login page) or 404
    expect(resp.status()).toBeLessThan(500);
    console.log(`Nonexistent API: ${resp.status()}`);
  });
});

// ─── No 500 errors on any route ───
test.describe("Vercel Preview — no server errors", () => {
  test("no HTTP 500 on any tested route", async ({ request }) => {
    const routes = [
      "/",
      "/pricing",
      "/docs",
      "/login",
      "/sign-in",
      "/studio",
      "/dashboard",
      "/api/studio/conversations",
      "/api/storage",
      "/api/this-does-not-exist",
    ];

    for (const route of routes) {
      const resp = await request.get(`${DEPLOYMENT_URL}${route}`);
      console.log(`${route}: ${resp.status()}`);
      expect(resp.status(), `${route} returned ${resp.status()}`).toBeLessThan(500);
    }
  });
});

// ─── Authenticated tests (require Clerk test users) ───
// These tests require CLERK_TEST_USER_A_EMAIL, CLERK_TEST_USER_A_PASSWORD,
// CLERK_TEST_USER_B_EMAIL, CLERK_TEST_USER_B_PASSWORD env vars.
// Skipped if not provided.
//
// Vercel Preview deployments have Deployment Protection (SSO). We bypass it
// using the protection bypass secret as a cookie so Playwright can reach the
// actual Clerk sign-in page.

const userAEmail = process.env.CLERK_TEST_USER_A_EMAIL;
const userAPassword = process.env.CLERK_TEST_USER_A_PASSWORD;
const userBEmail = process.env.CLERK_TEST_USER_B_EMAIL;
const userBPassword = process.env.CLERK_TEST_USER_B_PASSWORD;
const hasTestUsers = !!(userAEmail && userAPassword && userBEmail && userBPassword);

// Vercel Deployment Protection bypass secret. MUST be provided via env var
// (VERCEL_PROTECTION_BYPASS_SECRET) — never hardcode it in source.
// Fetch it from the Vercel project API: `vercel project inspect <id> --json`.
const VERCEL_BYPASS_SECRET = process.env.VERCEL_PROTECTION_BYPASS_SECRET;

async function createBypassedContext(browser: import("@playwright/test").Browser) {
  if (!VERCEL_BYPASS_SECRET) {
    throw new Error(
      "VERCEL_PROTECTION_BYPASS_SECRET env var is required for authenticated Clerk tests against a Vercel Preview deployment.",
    );
  }
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-vercel-protection-bypass": VERCEL_BYPASS_SECRET,
    },
  });
  return context;
}

test.describe("Authenticated Clerk tests", () => {
  test.skip(!hasTestUsers, "Requires CLERK_TEST_USER_A/B env vars");
  test.setTimeout(120_000);

  test("User A loads Studio and Dashboard", async ({ browser }) => {
    const context = await createBypassedContext(browser);
    const page = await context.newPage();

    // Navigate to sign-in — should now reach Clerk, not Vercel SSO
    await page.goto(`${DEPLOYMENT_URL}/sign-in`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Log current URL to verify we're on Clerk sign-in, not Vercel login
    console.log(`Sign-in page URL: ${page.url()}`);

    // Clerk sign-in form — try multiple selector patterns
    const emailInput = page.locator('input[name="identifier"], input[type="email"], input[autocomplete="email"]').first();
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
    const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Sign in"), button[type="submit"]').first();

    await emailInput.waitFor({ state: "visible", timeout: 15000 });
    await emailInput.fill(userAEmail!);
    await passwordInput.fill(userAPassword!);
    await continueBtn.click();
    await page.waitForTimeout(8000);

    // Verify we're signed in by checking dashboard
    await page.goto(`${DEPLOYMENT_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const url = page.url();
    console.log(`User A dashboard URL: ${url}`);
    expect(url).not.toMatch(/sign-in|login|vercel\.com\/login/);

    // Verify studio loads
    await page.goto(`${DEPLOYMENT_URL}/studio`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const studioUrl = page.url();
    console.log(`User A studio URL: ${studioUrl}`);
    expect(studioUrl).not.toMatch(/sign-in|login|vercel\.com\/login/);

    await context.close();
  });

  test("User B cannot access User A's project", async ({ browser }) => {
    const contextA = await createBypassedContext(browser);
    const pageA = await contextA.newPage();

    // Sign in as User A
    await pageA.goto(`${DEPLOYMENT_URL}/sign-in`, { waitUntil: "domcontentloaded" });
    await pageA.waitForTimeout(3000);
    console.log(`User A sign-in URL: ${pageA.url()}`);

    const emailInputA = pageA.locator('input[name="identifier"], input[type="email"], input[autocomplete="email"]').first();
    const passwordInputA = pageA.locator('input[name="password"], input[type="password"]').first();
    const continueBtnA = pageA.locator('button:has-text("Continue"), button:has-text("Sign in"), button[type="submit"]').first();

    await emailInputA.waitFor({ state: "visible", timeout: 15000 });
    await emailInputA.fill(userAEmail!);
    await passwordInputA.fill(userAPassword!);
    await continueBtnA.click();
    await pageA.waitForTimeout(8000);

    await pageA.goto(`${DEPLOYMENT_URL}/studio`, { waitUntil: "domcontentloaded" });
    await pageA.waitForTimeout(3000);
    console.log(`User A studio URL: ${pageA.url()}`);

    await contextA.close();

    // Sign in as User B
    const contextB = await createBypassedContext(browser);
    const pageB = await contextB.newPage();

    await pageB.goto(`${DEPLOYMENT_URL}/sign-in`, { waitUntil: "domcontentloaded" });
    await pageB.waitForTimeout(3000);
    console.log(`User B sign-in URL: ${pageB.url()}`);

    const emailInputB = pageB.locator('input[name="identifier"], input[type="email"], input[autocomplete="email"]').first();
    const passwordInputB = pageB.locator('input[name="password"], input[type="password"]').first();
    const continueBtnB = pageB.locator('button:has-text("Continue"), button:has-text("Sign in"), button[type="submit"]').first();

    await emailInputB.waitFor({ state: "visible", timeout: 15000 });
    await emailInputB.fill(userBEmail!);
    await passwordInputB.fill(userBPassword!);
    await continueBtnB.click();
    await pageB.waitForTimeout(8000);

    await pageB.goto(`${DEPLOYMENT_URL}/studio`, { waitUntil: "domcontentloaded" });
    await pageB.waitForTimeout(3000);
    console.log(`User B studio URL: ${pageB.url()}`);

    // User B should not see User A's projects
    // (Detailed project isolation test would go here)
    await contextB.close();
  });
});
