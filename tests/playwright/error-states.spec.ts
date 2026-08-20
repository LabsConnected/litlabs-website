import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Error and offline state tests.
 */

test.describe("Error states @public @error-states", () => {
  test("404 page renders branded not-found", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const response = await page.goto("/this-route-does-not-exist-12345");
    expect(response?.status()).toBe(404);

    // 404 page should have branded content, not a blank page
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(20);

    assertNoErrors(errors);
  });

  test("Protected API returns 401 or redirect when unauthenticated", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const response = await page.goto("/api/account");
    const status = response?.status() ?? 0;

    // Accept 401 (JSON), 307 (redirect), or 403 (forbidden)
    expect(
      status === 401 || status === 307 || status === 403,
      `Protected API should return 401/403/307, got ${status}`,
    ).toBe(true);

    if (status === 401 || status === 403) {
      const contentType = response?.headers()["content-type"] ?? "";
      expect(contentType).toContain("application/json");
    }

    assertNoErrors(errors);
  });

  test("Marketplace install API returns 401, 503, 307, or 405", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const response = await page.goto("/api/marketplace/agents/test-agent-id/install");
    const status = response?.status() ?? 0;
    // 405 is valid — the route is POST-only, so a GET probe gets Method Not Allowed.
    // That proves the route exists and is protected by method routing.
    expect(
      status === 401 || status === 503 || status === 307 || status === 405,
      `Marketplace install should return 401/503/307/405, got ${status}`,
    ).toBe(true);

    assertNoErrors(errors);
  });

  test("Marketplace checkout API returns 401, 503, 307, or 405", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const response = await page.goto("/api/marketplace/agents/test-agent-id/checkout");
    const status = response?.status() ?? 0;
    // 405 is valid — the route is POST-only, so a GET probe gets Method Not Allowed.
    expect(
      status === 401 || status === 503 || status === 307 || status === 405,
      `Marketplace checkout should return 401/503/307/405, got ${status}`,
    ).toBe(true);

    assertNoErrors(errors);
  });
});
