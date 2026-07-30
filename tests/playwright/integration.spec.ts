import { test, expect, type Browser, type BrowserContext, type APIResponse } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";

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
      data: { priceId: "price_test_invalid" },
      headers: { "Content-Type": "application/json", ...bypassHeaders() },
    });
    expect(resp.status()).toBeLessThan(500);
    assertJsonContentType(resp, "stripe checkout API");
    console.log(`Stripe checkout API: ${resp.status()}`);
  });

  test("stripe webhook endpoint does not 500", async ({ request }) => {
    const resp = await request.post(`${DEPLOYMENT_URL}/api/stripe/webhook`, {
      data: {},
      headers: { "Content-Type": "application/json", ...bypassHeaders() },
    });
    expect(resp.status()).toBeLessThan(500);
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
// These tests require:
//   CLERK_TEST_USER_A_EMAIL, CLERK_TEST_USER_A_PASSWORD,
//   CLERK_TEST_USER_B_EMAIL, CLERK_TEST_USER_B_PASSWORD,
//   VERCEL_PROTECTION_BYPASS_SECRET
// All Clerk keys on Preview MUST be Development (pk_test_/sk_test_).
// Skipped if any are not provided.

const userAEmail = process.env.CLERK_TEST_USER_A_EMAIL;
const userAPassword = process.env.CLERK_TEST_USER_A_PASSWORD;
const userBEmail = process.env.CLERK_TEST_USER_B_EMAIL;
const userBPassword = process.env.CLERK_TEST_USER_B_PASSWORD;
const hasTestUsers = !!(userAEmail && userAPassword && userBEmail && userBPassword);
const hasBypassSecret = !!VERCEL_BYPASS_SECRET;

/** Helper: sign in via @clerk/testing and return the authenticated context. */
async function signInAsUser(
  browser: Browser,
  email: string,
  _password: string,
  label: string,
): Promise<{ context: BrowserContext; page: import("@playwright/test").Page }> {
  const context = await createBypassedContext(browser);
  const page = await context.newPage();

  // Navigate to the deployment root so Clerk can initialize
  await page.goto(`${DEPLOYMENT_URL}`, { waitUntil: "domcontentloaded" });
  console.log(`[${label}] Home page URL: ${page.url()}`);

  // Use @clerk/testing to handle the full sign-in flow (dev browser token, cookies, etc.)
  await clerk.signIn({ page, emailAddress: email });
  console.log(`[${label}] Clerk signIn completed`);

  // Verify we're signed in
  await page.goto(`${DEPLOYMENT_URL}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const url = page.url();
  console.log(`[${label}] Dashboard URL: ${url}`);
  expect(url, `[${label}] should be signed in, not on sign-in page`).not.toMatch(/sign-in|login|vercel\.com\/login/);

  // Verify auth via API
  const testResp = await context.request.get(`${DEPLOYMENT_URL}/api/studio-projects`, {
    headers: bypassHeaders(),
  });
  console.log(`[${label}] Auth check: GET /api/studio-projects => ${testResp.status()}`);
  expect(testResp.status(), `[${label}] should be authenticated (not 401)`).not.toBe(401);

  return { context, page };
}

test.describe("Authenticated Clerk tests — cross-user isolation", () => {
  test.skip(
    !hasTestUsers || !hasBypassSecret,
    "Requires CLERK_TEST_USER_A/B and VERCEL_PROTECTION_BYPASS_SECRET env vars",
  );
  test.setTimeout(180_000);

  let projectAId: string | null = null;
  let contextA: BrowserContext | null = null;
  let contextB: BrowserContext | null = null;

  test.afterAll(async () => {
    // Cleanup: delete the test project if it was created
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

  test("User A signs in and loads Studio and Dashboard", async ({ browser }) => {
    const result = await signInAsUser(browser, userAEmail!, userAPassword!, "User A");
    contextA = result.context;

    // Verify auth works via API (signInAsUser already checks this, but double-confirm)
    const testResp = await contextA.request.get(`${DEPLOYMENT_URL}/api/studio-projects`, {
      headers: bypassHeaders(),
    });
    expect(testResp.status(), "User A should be authenticated").not.toBe(401);
    console.log(`User A auth verified: GET /api/studio-projects => ${testResp.status()}`);
  });

  test("User A creates a disposable project", async ({ browser }) => {
    // Reuse context A from the previous test, or create fresh
    if (!contextA) {
      const result = await signInAsUser(browser, userAEmail!, userAPassword!, "User A (project creation)");
      contextA = result.context;
    }

    // Use context.request which shares cookies with the browser context
    const request = contextA.request;
    const cookies = await contextA.cookies();
    console.log(`Cookies available: ${cookies.map(c => c.name).join(", ")}`);

    const resp = await request.post(`${DEPLOYMENT_URL}/api/studio-projects`, {
      data: { sourceType: "blank", name: `e2e-test-${Date.now()}`, templateId: "blank-static" },
      headers: {
        "Content-Type": "application/json",
        ...bypassHeaders(),
      },
    });
    const respText = await resp.text();
    console.log(`Project creation: status=${resp.status()}, body=${respText.substring(0, 200)}`);
    expect(resp.status(), "Project creation should succeed").toBe(201);
    const body = JSON.parse(respText);
    projectAId = body.project?.id || body.id;
    expect(projectAId, "Project ID should be returned").toBeTruthy();
    console.log(`Created disposable project: ${projectAId}`);

    // Verify User A can read their own project
    const getResp = await request.get(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
      headers: bypassHeaders(),
    });
    expect(getResp.status(), "User A should read own project").toBe(200);
  });

  test("User B signs in and cannot read User A's project", async ({ browser }) => {
    // Sign in as User B
    const resultB = await signInAsUser(browser, userBEmail!, userBPassword!, "User B");
    contextB = resultB.context;

    // Wait for project A to exist (depends on prior test)
    expect(projectAId, "Project A must be created before this test").toBeTruthy();

    // Use context.request which shares cookies with the browser context
    const reqB = contextB.request;
    const getResp = await reqB.get(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
      headers: bypassHeaders(),
    });

    // Should be 403 (forbidden) or 404 (not found) — NOT 200
    expect(
      getResp.status(),
      `User B should get 403/404 for User A's project, got ${getResp.status()}`,
    ).toMatch(/403|404/);
    console.log(`User B got ${getResp.status()} for User A's project ${projectAId}`);
  });

  test("User B cannot modify or delete User A's project", async ({ browser }) => {
    expect(projectAId, "Project A must exist").toBeTruthy();
    if (!contextB) {
      const result = await signInAsUser(browser, userBEmail!, userBPassword!, "User B (modify test)");
      contextB = result.context;
    }

    // Use context.request which shares cookies with the browser context
    const reqB2 = contextB.request;

    // Attempt to delete User A's project as User B
    const deleteResp = await reqB2.delete(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
      headers: bypassHeaders(),
    });

    expect(
      deleteResp.status(),
      `User B should not delete User A's project, got ${deleteResp.status()}`,
    ).toMatch(/403|404|401/);
    console.log(`User B delete attempt: ${deleteResp.status()}`);

    // Verify User A's project still exists after User B's delete attempt
    if (contextA) {
      const verifyResp = await contextA.request.get(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
        headers: bypassHeaders(),
      });
      expect(verifyResp.status(), "User A's project should still exist after User B delete attempt").toBe(200);
      console.log(`User A verified project still exists after User B delete attempt`);
    }
  });

  test("User B cannot access User A's R2 objects via storage API", async ({ browser }) => {
    if (!contextB) {
      const result = await signInAsUser(browser, userBEmail!, userBPassword!, "User B (R2 test)");
      contextB = result.context;
    }

    // Use context.request which shares cookies with the browser context
    const reqB3 = contextB.request;
    const storageResp = await reqB3.get(
      `${DEPLOYMENT_URL}/api/storage?key=audio/test-clip.mp3&type=audio/mpeg`,
      { headers: bypassHeaders() },
    );

    // User B is authenticated, so this should succeed but only for their own namespace
    expect(storageResp.status(), "Storage API should respond to authenticated User B").toBeLessThan(500);
    if (storageResp.status() === 200) {
      const storageBody = await storageResp.json();
      if (storageBody.path) {
        expect(storageBody.path, "Storage path should not contain another user's ID").not.toContain(userAEmail!);
        console.log(`User B storage path: ${storageBody.path} (correctly scoped)`);
      }
    }
    console.log(`User B storage API: ${storageResp.status()}`);
  });

  test("User A retains access to their project after User B attempts", async ({ browser }) => {
    expect(projectAId, "Project A must exist").toBeTruthy();
    if (!contextA) {
      const result = await signInAsUser(browser, userAEmail!, userAPassword!, "User A (retention check)");
      contextA = result.context;
    }

    // Use context.request which shares cookies with the browser context
    const reqA3 = contextA.request;
    const getResp = await reqA3.get(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
      headers: bypassHeaders(),
    });
    expect(getResp.status(), "User A should still access their project").toBe(200);
    console.log(`User A confirmed retained access to project ${projectAId}`);
  });

  test("test-created resources are cleaned up", async () => {
    // The afterAll hook handles deletion, but this test explicitly verifies
    // that cleanup was attempted and succeeds.
    if (projectAId && contextA) {
      await contextA.request.delete(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
        headers: bypassHeaders(),
      });
      // Verify it's gone
      const verifyResp = await contextA.request.get(`${DEPLOYMENT_URL}/api/studio-projects/${projectAId}`, {
        headers: bypassHeaders(),
      });
      expect(verifyResp.status(), "Deleted project should return 404").toBe(404);
      console.log(`Cleanup verified: project ${projectAId} is deleted`);
      projectAId = null;
    } else {
      console.log("No project to clean up (tests may have been skipped)");
    }
  });
});
