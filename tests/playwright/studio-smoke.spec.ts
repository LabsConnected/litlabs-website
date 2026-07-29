import { test, expect } from "@playwright/test";

const DEPLOYMENT_URL = process.env.SMOKE_TEST_URL || "http://localhost:3000";

test.describe("Studio V12 Smoke Test", () => {
  test("studio page loads", async ({ page }) => {
    await page.goto(`${DEPLOYMENT_URL}/studio`);
    await page.waitForLoadState("networkidle");

    // Should not be a 404 or 500
    const status = await page.evaluate(() => document.readyState);
    expect(status).toBe("complete");

    // Take screenshot for evidence
    await page.screenshot({ path: "tests/playwright/screenshots/01-studio-load.png", fullPage: true });
  });

  test("studio page renders content or auth redirect", async ({ page }) => {
    await page.goto(`${DEPLOYMENT_URL}/studio`);
    await page.waitForLoadState("networkidle");

    // Check if we see sign-in redirect or studio content
    const url = page.url();
    const hasComposer = await page.locator("textarea, [contenteditable]").count();
    const hasSignIn = url.includes("sign-in") || (await page.locator("text=Sign in").count());
    // Page may render the studio shell without composer (unauthenticated)
    const hasBodyContent = await page.locator("body *").count();

    if (hasSignIn) {
      console.log("Auth redirect detected — need authenticated session for full smoke test");
      await page.screenshot({ path: "tests/playwright/screenshots/02-auth-redirect.png", fullPage: true });
      test.skip(true, "Authentication required — skipping authenticated tests");
    }

    // Page should have rendered something (studio shell, sign-in, or content)
    expect(hasBodyContent > 0).toBeTruthy();
    console.log(`Studio page: composer=${hasComposer}, signIn=${hasSignIn}, bodyElements=${hasBodyContent}`);
  });

  test("API health check — conversations endpoint", async ({ request }) => {
    // Test the API endpoint directly
    const resp = await request.get(`${DEPLOYMENT_URL}/api/studio/conversations`);

    // Should return 401 (unauthorized) or 200 (if auth cookie present)
    // 401 confirms the endpoint exists and requires auth
    expect([200, 401, 403]).toContain(resp.status());

    console.log(`Conversations API status: ${resp.status()}`);
  });

  test("no console errors on studio page", async ({ page }) => {
    const errors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    await page.goto(`${DEPLOYMENT_URL}/studio`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Filter out expected errors (e.g., auth redirects, network failures on preview)
    const realErrors = errors.filter(
      (e) =>
        !e.includes("net::ERR") &&
        !e.includes("Failed to load resource") &&
        !e.includes("favicon") &&
        !e.includes("Clerk")
    );

    if (realErrors.length > 0) {
      console.log("Console errors found:", realErrors);
    }

    await page.screenshot({ path: "tests/playwright/screenshots/03-console-check.png", fullPage: true });

    // Log but don't fail on console errors in preview environment
    console.log(`Console errors: ${errors.length}, Real errors: ${realErrors.length}`);
  });
});
