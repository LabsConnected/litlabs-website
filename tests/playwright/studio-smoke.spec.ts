import { test, expect } from "@playwright/test";

const DEPLOYMENT_URL = process.env.SMOKE_TEST_URL || "http://localhost:3000";

test.describe("Public pages — exact status assertions", () => {
  test("homepage returns 200 and renders content", async ({ page }) => {
    const response = await page.goto(`${DEPLOYMENT_URL}/`);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("networkidle");

    const bodyContent = await page.locator("body *").count();
    expect(bodyContent).toBeGreaterThan(0);

    await page.screenshot({ path: "tests/playwright/screenshots/01-homepage.png", fullPage: true });
  });

  test("pricing page returns 200", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/pricing`);
    expect(resp.status()).toBe(200);
    console.log(`/pricing: ${resp.status()}`);
  });

  test("docs page returns 200", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/docs`);
    expect(resp.status()).toBe(200);
    console.log(`/docs: ${resp.status()}`);
  });

  test("login page returns 200", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/login`);
    expect(resp.status()).toBe(200);
    console.log(`/login: ${resp.status()}`);
  });

  test("sign-in page returns 200", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/sign-in`);
    expect(resp.status()).toBe(200);
    console.log(`/sign-in: ${resp.status()}`);
  });
});

test.describe("Protected pages — unauthenticated behavior", () => {
  test("studio page returns 200 with embedded sign-in screen (not a redirect)", async ({ page }) => {
    const response = await page.goto(`${DEPLOYMENT_URL}/studio`);
    expect(response?.status()).toBe(200);

    // Wait for Clerk to load — with a custom domain it may take extra time
    await page.waitForTimeout(5000);

    // Studio intentionally renders an embedded sign-in screen at HTTP 200
    // (not a redirect). Verify the sign-in content is present.
    const url = page.url();
    expect(url).toContain("/studio");

    const hasSignInLink = await page.locator("text=Sign in to Studio").count();
    const hasCreateAccount = await page.locator("text=Create free account").count();
    const hasMemberOnly = await page.locator("text=member-only").count();
    const hasClerkComponent = await page.locator(".cl-root, [data-clerk], .cl-signIn-root, .cl-card").count();
    const hasLoadingState = await page.locator("text=Initializing Studio").count();

    // At least one of these elements must be present (sign-in or loading state)
    expect(hasSignInLink + hasCreateAccount + hasMemberOnly + hasClerkComponent + hasLoadingState).toBeGreaterThan(0);
    console.log(`Studio: status=200, url=${url}, signInLink=${hasSignInLink}, memberOnly=${hasMemberOnly}, clerkComponent=${hasClerkComponent}, loading=${hasLoadingState}`);

    await page.screenshot({ path: "tests/playwright/screenshots/02-studio.png", fullPage: true });
  });

  test("dashboard page returns 200 and renders content", async ({ page }) => {
    const response = await page.goto(`${DEPLOYMENT_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await page.waitForTimeout(3000);

    // Dashboard is not in middleware protected routes — it renders at 200
    const url = page.url();
    expect(url).toContain("/dashboard");

    const hasBodyContent = await page.locator("body *").count();
    expect(hasBodyContent).toBeGreaterThan(0);
    console.log(`Dashboard: status=200, url=${url}, bodyElements=${hasBodyContent}`);

    await page.screenshot({ path: "tests/playwright/screenshots/03-dashboard.png", fullPage: true });
  });
});

test.describe("API endpoints — exact status assertions", () => {
  test("protected API returns 401 when unauthenticated", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/api/studio/conversations`);
    expect(resp.status()).toBe(401);
    console.log(`Conversations API: ${resp.status()}`);
  });

  test("nonexistent API route returns 404", async ({ request }) => {
    const resp = await request.get(`${DEPLOYMENT_URL}/api/this-does-not-exist`);
    expect(resp.status()).toBe(404);
    console.log(`Nonexistent API: ${resp.status()}`);
  });
});

test.describe("No server errors", () => {
  test("no unexpected console errors on homepage", async ({ page }) => {
    const errors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    await page.goto(`${DEPLOYMENT_URL}/`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const realErrors = errors.filter(
      (e) =>
        !e.includes("net::ERR") &&
        !e.includes("Failed to load resource") &&
        !e.includes("favicon") &&
        !e.includes("Clerk") &&
        !e.includes("Minified React error #418"),
    );

    expect(realErrors).toEqual([]);
    console.log(`Console errors: ${errors.length}, Real errors: ${realErrors.length}`);
  });

  test("no HTTP 500 responses on any tested route", async ({ request }) => {
    const routes = ["/", "/pricing", "/docs", "/login", "/sign-in", "/studio", "/dashboard"];

    for (const route of routes) {
      const resp = await request.get(`${DEPLOYMENT_URL}${route}`);
      console.log(`${route}: ${resp.status()}`);
      expect(resp.status(), `${route} returned ${resp.status()}`).toBeLessThan(500);
    }

    const apiRoutes = ["/api/studio/conversations", "/api/this-does-not-exist"];
    for (const route of apiRoutes) {
      const resp = await request.get(`${DEPLOYMENT_URL}${route}`);
      console.log(`${route}: ${resp.status()}`);
      expect(resp.status(), `${route} returned ${resp.status()}`).toBeLessThan(500);
    }
  });
});
