import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Security and authorization tests.
 */

test.describe("Security @public @security", () => {
  test("Protected pages redirect to sign-in or show sign-in prompt", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const protectedRoutes = ["/settings", "/profile", "/wallet", "/dashboard"];

    for (const route of protectedRoutes) {
      const response = await page.goto(route);
      const status = response?.status() ?? 0;

      // Accept 307/302 (redirect to sign-in) OR 200 with sign-in content
      // In local dev, middleware may not be active, so the page may render
      // with an unauthenticated state that shows a sign-in prompt
      if (status === 307 || status === 302) {
        const url = page.url();
        expect(url, `${route} should redirect to sign-in`).toContain("/sign-in");
      } else if (status === 200) {
        // Page rendered — should show sign-in prompt or unauthenticated state
        await page.waitForLoadState("networkidle");
        const bodyText = await page.locator("body").textContent() ?? "";
        // Should contain sign-in related text
        const hasSignInPrompt = /sign|Sign|login|Login|unauthorized|member/i.test(bodyText);
        expect(
          hasSignInPrompt,
          `${route} should show sign-in prompt when unauthenticated`,
        ).toBe(true);
      } else {
        throw new Error(`Protected route ${route} returned unexpected status ${status}`);
      }
    }

    assertNoErrors(errors);
  });

  test("Protected API endpoints return 401/403 or redirect to sign-in", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const apiRoutes = ["/api/account", "/api/wallet/balance", "/api/settings/profile"];

    for (const route of apiRoutes) {
      const response = await page.goto(route);
      const status = response?.status() ?? 0;

      // Accept 401 (JSON), 403 (forbidden), or 307 (redirect to sign-in)
      expect(
        status === 401 || status === 403 || status === 307,
        `API ${route} should return 401/403/307, got ${status}`,
      ).toBe(true);

      if (status === 401 || status === 403) {
        const contentType = response?.headers()["content-type"] ?? "";
        expect(contentType, `API ${route} should return JSON when 401/403`).toContain("application/json");
      }
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
    expect(url, "Should not redirect to Clerk dev domain").not.toContain("clerk.dev");
    expect(url, "Should not redirect to develop-domain").not.toContain("develop-domain");

    assertNoErrors(errors);
  });
});
