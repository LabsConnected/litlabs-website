import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Security and authorization tests.
 */

test.describe("Security @public @security", () => {
  test("Protected pages redirect to sign-in with redirect parameter", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const protectedRoutes = ["/settings", "/profile", "/wallet", "/dashboard"];

    for (const route of protectedRoutes) {
      const response = await page.goto(route);
      const status = response?.status() ?? 0;

      expect(
        status === 307 || status === 302,
        `Protected route ${route} should redirect, got ${status}`,
      ).toBe(true);

      const url = page.url();
      expect(url, `${route} should redirect to sign-in`).toContain("/sign-in");
      expect(url, `${route} should preserve redirect destination`).toContain("redirect=");
    }

    assertNoErrors(errors);
  });

  test("Protected API endpoints return JSON 401/403, not HTML redirects", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const apiRoutes = ["/api/account", "/api/wallet/balance", "/api/settings/profile"];

    for (const route of apiRoutes) {
      const response = await page.goto(route);
      const status = response?.status() ?? 0;

      expect(
        status === 401 || status === 403,
        `API ${route} should return 401/403, got ${status}`,
      ).toBe(true);

      const contentType = response?.headers()["content-type"] ?? "";
      expect(contentType, `API ${route} should return JSON`).toContain("application/json");
    }

    assertNoErrors(errors);
  });

  test("Public routes do not expose protected data", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const publicRoutes = ["/", "/pricing", "/marketplace", "/gallery"];

    for (const route of publicRoutes) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");

      const bodyText = await page.locator("body").innerText();

      // Public pages should not expose user-specific data
      expect(bodyText, `${route} should not expose API keys`).not.toMatch(/sk_live_|sk_test_|STRIPE_SECRET/);
      expect(bodyText, `${route} should not expose JWT tokens`).not.toMatch(/eyJ[a-zA-Z0-9_-]*\.eyJ/);
      expect(bodyText, `${route} should not expose Supabase keys`).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE/);
    }

    assertNoErrors(errors);
  });

  test("No Clerk development domain appears in production", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const url = page.url();
    // Should not redirect to clerk.dev or develop-domain
    expect(url, "Should not redirect to Clerk dev domain").not.toContain("clerk.dev");
    expect(url, "Should not redirect to develop-domain").not.toContain("develop-domain");

    assertNoErrors(errors);
  });
});
