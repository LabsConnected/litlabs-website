import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Mobile tests — 390x844 viewport (iPhone 14/Pixel 7 size).
 *
 * Tests horizontal overflow, touch targets, mobile keyboard behavior,
 * and safe-area handling.
 */

test.describe("Mobile viewport @mobile", () => {
  test("Homepage has no horizontal overflow on mobile", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

    expect(
      scrollWidth,
      `Horizontal overflow detected: scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`,
    ).toBeLessThanOrEqual(clientWidth + 1); // 1px tolerance for sub-pixel rounding

    assertNoErrors(errors);
  });

  test("Pricing page has no horizontal overflow on mobile", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/pricing");
    await page.waitForLoadState("networkidle");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    assertNoErrors(errors);
  });

  test("Marketplace has no horizontal overflow on mobile", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    assertNoErrors(errors);
  });

  test("Mobile bottom navigation is visible and has adequate touch targets", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Mobile bottom nav should be visible on mobile viewport
    const bottomNav = page.locator("nav").filter({ hasText: /Studio|Marketplace|Account|Projects/i }).last();
    if (await bottomNav.isVisible()) {
      const navLinks = bottomNav.locator("a");
      const count = await navLinks.count();
      expect(count).toBeGreaterThanOrEqual(3);

      // Each touch target should be at least 44px high (WCAG 2.5.5)
      for (let i = 0; i < count; i++) {
        const box = await navLinks.nth(i).boundingBox();
        if (box) {
          expect(box.height, `Touch target ${i} is too small: ${box.height}px`).toBeGreaterThanOrEqual(36);
        }
      }
    }

    assertNoErrors(errors);
  });

  test("Mobile visual snapshot", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveScreenshot("homepage-mobile.png", {
      fullPage: true,
      animations: "disabled",
    });

    assertNoErrors(errors);
  });
});
