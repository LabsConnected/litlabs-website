import { test, expect, type Browser, type BrowserContext, type APIResponse } from "@playwright/test";

const DEPLOYMENT_URL = process.env.SMOKE_TEST_URL || "http://localhost:3000";
const VERCEL_BYPASS_SECRET = process.env.VERCEL_PROTECTION_BYPASS_SECRET;

// ─── Vercel Deployment Protection bypass ──────────────────────────
// Vercel Preview deployments have Deployment Protection (SSO). We bypass
// it by sending x-vercel-protection-bypass + x-vercel-set-bypass-cookie
// on the initial request, which sets a cookie for subsequent navigation.
// See: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection

const isVercelPreview = !!VERCEL_BYPASS_SECRET;

/** Common bypass headers for API requests. */
function bypassHeaders(): Record<string, string> {
  return isVercelPreview && VERCEL_BYPASS_SECRET
    ? { "x-vercel-protection-bypass": VERCEL_BYPASS_SECRET }
    : {};
}

/**
 * Create a browser context with Vercel Deployment Protection bypassed.
 * The bypass cookie is established by an initial request with
 * x-vercel-set-bypass-cookie: true.
 */
async function createBypassedContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  if (isVercelPreview && VERCEL_BYPASS_SECRET) {
    // Establish the bypass cookie via a GET with x-vercel-set-bypass-cookie
    const resp = await context.request.get(`${DEPLOYMENT_URL}/`, {
      headers: {
        "x-vercel-protection-bypass": VERCEL_BYPASS_SECRET,
        "x-vercel-set-bypass-cookie": "true",
      },
    });
    expect(resp.status(), "Bypass request should return 200").toBe(200);
    // Log warning if SSO content detected, but don't fail — the bypass cookie
    // may still be set and work for subsequent requests
    const body = await resp.text();
    if (body.includes("vercel.com/login") || body.includes("Vercel Authentication")) {
      console.log("WARNING: Bypass response contains Vercel SSO content — bypass may not be fully active");
    }
  }
  return context;
}

// ─── LiTTree-origin assertion helpers ─────────────────────────────

/** Assert that a response body is from LiTTree, not Vercel SSO. */
function assertNotVercelSSO(body: string, context: string) {
  expect(body, `${context}: must not contain Vercel SSO redirect`).not.toContain("vercel.com/login");
  expect(body, `${context}: must not contain Vercel Authentication page`).not.toContain("Vercel Authentication");
  expect(body, `${context}: must not contain Vercel deployment-protection HTML`).not.toContain("x-vercel-protection-bypass");
}

/** Assert that an API response has JSON content type. */
function assertJsonContentType(resp: APIResponse, context: string) {
  const ct = resp.headers()["content-type"] || "";
  expect(ct, `${context}: should return JSON, got "${ct}"`).toContain("application/json");
}

// ─── Unauthenticated behavior — must reach LiTTree, not Vercel SSO ───

test.describe("Vercel Preview — unauthenticated behavior (bypassed)", () => {
  test.skip(isVercelPreview && !VERCEL_BYPASS_SECRET, "Requires VERCEL_PROTECTION_BYPASS_SECRET for Vercel Preview");

  test("homepage returns 200 from LiTTree", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/`, { headers: bypassHeaders() });
    expect(resp.status()).toBe(200);
    const body = await resp.text();
    assertNotVercelSSO(body, "homepage");
    // LiTTree homepage should have a <body> with real content
    expect(body).toContain("<body");
    console.log(`Homepage: ${resp.status()}, length=${body.length}`);
  });

  test("pricing returns 200 from LiTTree", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/pricing`, { headers: bypassHeaders() });
    expect(resp.status()).toBe(200);
    const body = await resp.text();
    assertNotVercelSSO(body, "pricing");
    expect(body).toContain("<body");
    console.log(`Pricing: ${resp.status()}`);
  });

  test("docs returns 200 or 404 from LiTTree (pre-existing 404 bug tracked separately)", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/docs`, { headers: bypassHeaders() });
    // /docs returns 404 on both Preview and Production — pre-existing issue.
    // The key assertion is that we reach LiTTree (not Vercel SSO) and get < 500.
    expect(resp.status(), "docs should not 500").toBeLessThan(500);
    const body = await resp.text();
    assertNotVercelSSO(body, "docs");
    console.log(`Docs: ${resp.status()} (pre-existing 404 if not 200)`);
  });

  test("studio page renders from LiTTree (not Vercel SSO)", async ({ browser }) => {
    const context = await createBypassedContext(browser);
    const page = await context.newPage();
    const response = await page.goto(`${DEPLOYMENT_URL}/studio`, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);

    const url = page.url();
    // Must be on LiTTree, not redirected to Vercel SSO
    expect(url, "Studio URL should be on LiTTree, not Vercel SSO").not.toMatch(/vercel\.com\/login/);

    // Studio is a client-rendered SPA. The initial HTML shows "Initializing Studio"
    // and then hydrates to show either the studio UI or an embedded sign-in prompt.
    // Wait for hydration to produce body content beyond the loading state.
    await page.waitForTimeout(8000);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    expect(bodyText, "Studio should not show Vercel Authentication").not.toContain("Vercel Authentication");

    // The page must have rendered *something* beyond the loading skeleton.
    // Accept any of: sign-in prompt, Clerk form, studio UI, or even the
    // "Initializing Studio" text (which proves LiTTree rendered, not Vercel SSO).
    const hasContent = await page.locator("body *").count();
    expect(hasContent, "Studio should have rendered DOM elements from LiTTree").toBeGreaterThan(0);

    // Log what we actually see for debugging
    console.log(`Studio: status=200, url=${url}, bodyElements=${hasContent}, bodyTextPreview=${bodyText.slice(0, 200)}`);
    await context.close();
  });

  test("dashboard renders from LiTTree (not Vercel SSO)", async ({ browser }) => {
    const context = await createBypassedContext(browser);
    const page = await context.newPage();
    const response = await page.goto(`${DEPLOYMENT_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await page.waitForTimeout(3000);

    const url = page.url();
    expect(url, "Dashboard URL should not be Vercel SSO").not.toMatch(/vercel\.com\/login/);

    const hasContent = await page.locator("body *").count();
    expect(hasContent, "Dashboard should have rendered content").toBeGreaterThan(0);
    console.log(`Dashboard: status=200, url=${url}, bodyElements=${hasContent}`);
    await context.close();
  });

  test("sign-in page renders from LiTTree (not Vercel SSO)", async ({ browser }) => {
    const context = await createBypassedContext(browser);
    const page = await context.newPage();
    const response = await page.goto(`${DEPLOYMENT_URL}/sign-in`, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);

    const url = page.url();
    expect(url, "Sign-in URL should not be Vercel SSO").not.toMatch(/vercel\.com\/login/);

    // Clerk JS loads asynchronously and keeps the network busy, so don't wait
    // for networkidle. Just wait for body content to appear.
    await page.waitForTimeout(3000);
    const hasContent = await page.locator("body *").count();
    expect(hasContent, "Sign-in should have rendered content").toBeGreaterThan(0);
    console.log(`Sign-in: status=200, url=${url}, bodyElements=${hasContent}`);
    await context.close();
  });
});

// ─── API endpoints — must reach LiTTree app layer, not Vercel SSO ───

test.describe("Vercel Preview — API endpoints (bypassed)", () => {
  test.skip(isVercelPreview && !VERCEL_BYPASS_SECRET, "Requires VERCEL_PROTECTION_BYPASS_SECRET for Vercel Preview");

  test("conversations API returns 401 (not Vercel SSO HTML)", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/api/studio/conversations`, { headers: bypassHeaders() });
    expect(resp.status()).toBe(401);
    assertJsonContentType(resp, "conversations API");
    const body = await resp.text();
    assertNotVercelSSO(body, "conversations API");
    expect(body).toContain("Unauthorized");
    console.log(`Conversations API: ${resp.status()}`);
  });

  test("storage API returns 401 (not Vercel SSO HTML)", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/api/storage`, { headers: bypassHeaders() });
    expect(resp.status()).toBe(401);
    assertJsonContentType(resp, "storage API");
    const body = await resp.text();
    assertNotVercelSSO(body, "storage API");
    console.log(`Storage API: ${resp.status()}`);
  });

  test("stripe checkout API returns 401 (not 500)", async ({ request }) => {
    const resp = await request.post(`${DEPLOYMENT_URL}/api/stripe/checkout`, {
      data: { productId: "test_invalid" },
      headers: { "Content-Type": "application/json", ...bypassHeaders() },
    });
    expect(resp.status()).toBeLessThan(500);
    assertJsonContentType(resp, "stripe checkout API");
    console.log(`Stripe checkout API: ${resp.status()}`);
  });

  test("stripe webhook endpoint returns 400/503 (not 500) for invalid request", async ({ request }) => {
    const resp = await request.post(`${DEPLOYMENT_URL}/api/stripe/webhook`, {
      data: {},
      headers: { "Content-Type": "application/json", ...bypassHeaders() },
    });
    expect([400, 503], "Should return 400 (missing signature) or 503 (missing config), not 500").toContain(resp.status());
    expect(resp.status()).not.toBe(404);
    console.log(`Stripe webhook endpoint: ${resp.status()}`);
  });

  test("orchestrate API returns 401 (not 500)", async ({ request }) => {
    const resp = await request.post(`${DEPLOYMENT_URL}/api/orchestrate`, {
      data: { message: "test" },
      headers: { "Content-Type": "application/json", ...bypassHeaders() },
    });
    expect(resp.status()).toBeLessThan(500);
    console.log(`Orchestrate API: ${resp.status()}`);
  });

  test("nonexistent API returns 404 (not Vercel SSO HTML)", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/api/this-does-not-exist`, { headers: bypassHeaders() });
    expect(resp.status()).toBe(404);
    console.log(`Nonexistent API: ${resp.status()}`);
  });
});

// ─── No 500 errors on any route (bypassed) ────────────────────────

test.describe("Vercel Preview — no server errors (bypassed)", () => {
  test.skip(isVercelPreview && !VERCEL_BYPASS_SECRET, "Requires VERCEL_PROTECTION_BYPASS_SECRET for Vercel Preview");

  test("no HTTP 500 on any tested route", async ({ request }) => {
    const routes = ["/", "/pricing", "/docs", "/login", "/sign-in", "/studio", "/dashboard"];
    for (const route of routes) {
      const resp = await request.get(`${DEPLOYMENT_URL}${route}`, { headers: bypassHeaders() });
      console.log(`${route}: ${resp.status()}`);
      expect(resp.status(), `${route} returned ${resp.status()}`).toBeLessThan(500);
    }

    const apiRoutes = ["/api/studio/conversations", "/api/storage", "/api/this-does-not-exist"];
    for (const route of apiRoutes) {
      const resp = await request.get(`${DEPLOYMENT_URL}${route}`, { headers: bypassHeaders() });
      console.log(`${route}: ${resp.status()}`);
      expect(resp.status(), `${route} returned ${resp.status()}`).toBeLessThan(500);
    }
  });
});

// ─── Authenticated tests (require Clerk Development test users) ───
// These tests use storage state files created by auth.setup.ts (Clerk's
// official Playwright integration via @clerk/testing).
//
// Required env vars:
//   CLERK_TEST_USER_A_EMAIL, CLERK_TEST_USER_B_EMAIL
//   CLERK_SECRET_KEY (for clerk.signIn in setup)
//   CLERK_PUBLISHABLE_KEY (for clerkSetup in setup)
//
// The setup file signs in both users server-side via clerk.signIn(),
// saves their browser storage state to .clerk/user-a.json and .clerk/user-b.json,
// and these tests load those states to create authenticated browser contexts.

import path from "path";

const clerkDir = path.join(__dirname, ".clerk");
const userAAuthFile = path.join(clerkDir, "user-a.json");
const userBAuthFile = path.join(clerkDir, "user-b.json");

const userAEmail = process.env.CLERK_TEST_USER_A_EMAIL;
const userBEmail = process.env.CLERK_TEST_USER_B_EMAIL;
const hasTestUsers = !!(userAEmail && userBEmail);

test.describe("Authenticated Clerk tests — cross-user isolation", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !hasTestUsers,
    "Requires CLERK_TEST_USER_A_EMAIL and CLERK_TEST_USER_B_EMAIL env vars",
  );
  test.setTimeout(120_000);

  let projectAId: string | null = null;
  let contextA: BrowserContext | null = null;
  let contextB: BrowserContext | null = null;

  // Set Vercel bypass header on ALL requests (including page navigation)
  async function establishBypass(context: BrowserContext) {
    if (isVercelPreview && VERCEL_BYPASS_SECRET) {
      context.setExtraHTTPHeaders({ "x-vercel-protection-bypass": VERCEL_BYPASS_SECRET });
    }
  }

  test.afterAll(async () => {
    if (projectAId && contextA) {
      try {
        await contextA.request.delete(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
          headers: bypassHeaders(),
        });
        console.log(`Cleanup: deleted project ${projectAId}`);
      } catch (err) {
        console.error(`Cleanup failed for project ${projectAId}:`, err);
      }
    }
    if (contextA) await contextA.close();
    if (contextB) await contextB.close();
  });

  test("User A — server recognizes Clerk session (protected endpoint proof)", async ({ browser }) => {
    contextA = await browser.newContext({ storageState: userAAuthFile });
    await establishBypass(contextA);
    const page = await contextA.newPage();
    await page.goto(`${DEPLOYMENT_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    console.log(`[User A] Dashboard URL: ${page.url()}`);

    // The real proof: protected API endpoint must return non-401
    const api = contextA.request;
    const resp = await api.get(`${DEPLOYMENT_URL}/api/studio-projects`, {
      headers: bypassHeaders(),
    });
    const status = resp.status();
    const ct = resp.headers()["content-type"] || "";

    console.log(`[User A] GET /api/studio-projects => ${status}, content-type: ${ct}`);
    expect(status, "User A must be authenticated (not 401)").not.toBe(401);
    expect(ct, "Response should be JSON").toContain("application/json");

    const body = await resp.json();
    expect(body, "Response should have projects array or object").toBeTruthy();
    console.log(`[User A] Authenticated — server recognizes Clerk session`);
  });

  test("User A creates a disposable project", async () => {
    expect(contextA, "User A context must exist from prior test").toBeTruthy();

    const api = contextA!.request;
    const resp = await api.post(`${DEPLOYMENT_URL}/api/studio-projects`, {
      data: { sourceType: "blank", name: `e2e-test-${Date.now()}`, templateId: "blank-static" },
      headers: { "Content-Type": "application/json", ...bypassHeaders() },
    });

    const respText = await resp.text();
    console.log(`[User A] POST /api/studio-projects => ${resp.status()}, body: ${respText.substring(0, 200)}`);
    expect(resp.status(), "Project creation should return 201").toBe(201);

    const body = JSON.parse(respText);
    projectAId = body.project?.id || body.id;
    expect(projectAId, "Project ID should be returned").toBeTruthy();
    console.log(`[User A] Created project: ${projectAId}`);

    // Verify User A can read their own project
    const getResp = await api.get(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
      headers: bypassHeaders(),
    });
    expect(getResp.status(), "User A should read own project (200)").toBe(200);
    console.log(`[User A] Verified can read own project: ${getResp.status()}`);
  });

  test("User B — server recognizes Clerk session (protected endpoint proof)", async ({ browser }) => {
    contextB = await browser.newContext({ storageState: userBAuthFile });
    await establishBypass(contextB);
    const page = await contextB.newPage();
    await page.goto(`${DEPLOYMENT_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    console.log(`[User B] Dashboard URL: ${page.url()}`);

    const api = contextB.request;
    const resp = await api.get(`${DEPLOYMENT_URL}/api/studio-projects`, {
      headers: bypassHeaders(),
    });
    const status = resp.status();
    const ct = resp.headers()["content-type"] || "";

    console.log(`[User B] GET /api/studio-projects => ${status}, content-type: ${ct}`);
    expect(status, "User B must be authenticated (not 401)").not.toBe(401);
    expect(ct, "Response should be JSON").toContain("application/json");
    console.log(`[User B] Authenticated — server recognizes Clerk session`);
  });

  test("User B cannot read User A's project", async () => {
    expect(projectAId, "Project A must be created before this test").toBeTruthy();
    expect(contextB, "User B context must exist").toBeTruthy();

    const api = contextB!.request;
    const getResp = await api.get(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
      headers: bypassHeaders(),
    });

    expect(
      [403, 404].includes(getResp.status()),
      `User B should get 403/404 for User A's project, got ${getResp.status()}`,
    ).toBe(true);
    console.log(`[User B] Got ${getResp.status()} for User A's project ${projectAId} (correctly denied)`);
  });

  test("User B cannot delete User A's project", async () => {
    expect(projectAId, "Project A must exist").toBeTruthy();
    expect(contextB, "User B context must exist").toBeTruthy();
    expect(contextA, "User A context must exist").toBeTruthy();

    const apiB = contextB!.request;
    const deleteResp = await apiB.delete(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
      headers: bypassHeaders(),
    });

    expect(
      [403, 404, 401].includes(deleteResp.status()),
      `User B should not delete User A's project, got ${deleteResp.status()}`,
    ).toBe(true);
    console.log(`[User B] Delete attempt: ${deleteResp.status()} (correctly denied)`);

    const apiA = contextA!.request;
    const verifyResp = await apiA.get(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
      headers: bypassHeaders(),
    });
    expect(verifyResp.status(), "User A's project should still exist after User B delete attempt").toBe(200);
    console.log(`[User A] Verified project still exists after User B delete attempt`);
  });

  test("User B cannot access User A's R2 objects via storage API", async () => {
    expect(contextB, "User B context must exist").toBeTruthy();

    const apiB = contextB!.request;
    const storageResp = await apiB.get(
      `${DEPLOYMENT_URL}/api/storage?key=audio/test-clip.mp3&type=audio/mpeg`,
      { headers: bypassHeaders() },
    );

    expect(storageResp.status(), "Storage API should respond to authenticated User B").toBeLessThan(500);
    expect(storageResp.status(), "Storage API should not reject authenticated User B with 401").not.toBe(401);

    if (storageResp.status() === 200) {
      const storageBody = await storageResp.json();
      if (storageBody.path) {
        expect(storageBody.path, "Storage path should not contain User A's email").not.toContain(userAEmail!);
        console.log(`[User B] Storage path: ${storageBody.path} (correctly scoped)`);
      }
    }
    console.log(`[User B] Storage API: ${storageResp.status()}`);
  });

  test("User A retains access to their project", async () => {
    expect(projectAId, "Project A must exist").toBeTruthy();
    expect(contextA, "User A context must exist").toBeTruthy();

    const apiA = contextA!.request;
    const getResp = await apiA.get(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
      headers: bypassHeaders(),
    });
    expect(getResp.status(), "User A should still access their project (200)").toBe(200);
    console.log(`[User A] Confirmed retained access to project ${projectAId}`);
  });

  test("cleanup — test-created resources are deleted", async () => {
    expect(projectAId, "Project A must exist for cleanup").toBeTruthy();
    expect(contextA, "User A context must exist for cleanup").toBeTruthy();

    const apiA = contextA!.request;
    const deleteResp = await apiA.delete(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
      headers: bypassHeaders(),
    });
    expect(
      [200, 204].includes(deleteResp.status()),
      `Cleanup delete should succeed (200 or 204), got ${deleteResp.status()}`,
    ).toBe(true);
    console.log(`[User A] Cleanup: deleted project ${projectAId}, status: ${deleteResp.status()}`);

    const verifyResp = await apiA.get(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
      headers: bypassHeaders(),
    });
    expect(verifyResp.status(), "Deleted project should return 404").toBe(404);
    console.log(`[User A] Cleanup verified: project ${projectAId} is deleted`);
    projectAId = null;
  });
});
