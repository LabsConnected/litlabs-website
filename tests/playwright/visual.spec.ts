import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Visual regression tests — compare against approved baselines.
 *
 * Baselines are generated on first run and must be committed.
 * Run `pnpm exec playwright test --update-snapshots` to regenerate.
 *
 * Note: Visual snapshots are OS/browser-specific. Generate baselines
 * in the same CI environment where they will be compared.
 */

test.describe("Visual regression @public", () => {
  test("Homepage desktop layout", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("homepage-desktop.png", {
      fullPage: true,
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
      mask: [
        page.locator("[data-testid='user-avatar']").filter({ hasText: "" }),
      ],
    });

    assertNoErrors(errors);
  });

  test("Pricing page desktop layout", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/pricing");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("pricing-desktop.png", {
      fullPage: true,
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
      mask: [
        page.locator("[data-testid='user-avatar']").filter({ hasText: "" }),
      ],
    });

    assertNoErrors(errors);
  });

  test("Marketplace page desktop layout", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("marketplace-desktop.png", {
      fullPage: true,
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    assertNoErrors(errors);
  });
});
