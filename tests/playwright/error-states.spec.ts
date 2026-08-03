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

  test("Protected API returns JSON 401 when unauthenticated", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const response = await page.goto("/api/account");
    expect(response?.status()).toBe(401);

    const contentType = response?.headers()["content-type"] ?? "";
    // Should return JSON, not HTML redirect
    expect(contentType).toContain("application/json");

    const body = await page.locator("body").innerText();
    expect(body).toContain("Unauthorized");

    assertNoErrors(errors);
  });

  test("Marketplace install API returns 503 when feature-flagged off", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const response = await page.goto("/api/marketplace/agents/test-agent-id/install");
    // Should return 401 (unauthenticated) or 503 (feature flag off)
    const status = response?.status() ?? 0;
    expect(
      status === 401 || status === 503,
      `Marketplace install should return 401 or 503, got ${status}`,
    ).toBe(true);

    assertNoErrors(errors);
  });

  test("Marketplace checkout API returns 503 when feature-flagged off", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const response = await page.goto("/api/marketplace/agents/test-agent-id/checkout");
    const status = response?.status() ?? 0;
    expect(
      status === 401 || status === 503,
      `Marketplace checkout should return 401 or 503, got ${status}`,
    ).toBe(true);

    assertNoErrors(errors);
  });
});
