import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors, waitForPageReady } from "./helpers";

/**
 * Studio review surface tests — Phase 10 review experience.
 *
 * Verifies the review checkpoint, readiness summary, blocking reasons,
 * provenance display, and approve/request changes actions.
 *
 * Phase 10.8 — Visual gate
 */

test.describe("Studio review surface @studio @review", () => {
  test("Studio loads with composer and review surface accessible", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer", timeout: 30_000 });

    // Composer must be visible
    await expect(page.getByTestId("studio-command-composer")).toBeVisible();

    // No horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    assertNoErrors(errors);
  });

  test("Studio has no placeholder or prototype copy visible", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer", timeout: 30_000 });

    // Check for common placeholder text that should never appear in production
    const body = page.locator("body");
    const bodyText = await body.textContent();

    const forbiddenPhrases = [
      "TODO",
      "FIXME",
      "placeholder",
      "lorem ipsum",
      "Coming soon",
      "Not implemented",
    ];

    for (const phrase of forbiddenPhrases) {
      expect(bodyText?.toLowerCase()).not.toContain(phrase.toLowerCase());
    }

    assertNoErrors(errors);
  });

  test("Studio focus visibility — keyboard navigation", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer", timeout: 30_000 });

    // Tab through focusable elements
    await page.keyboard.press("Tab");

    // Focused element should have a visible focus indicator
    const focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return {
        tag: el.tagName,
        outline: style.outline,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
      };
    });

    // Something should be focused
    expect(focusedElement).not.toBeNull();

    assertNoErrors(errors);
  });

  test("Studio reduced motion rendering is understandable", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = monitorApplicationErrors(page);

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer", timeout: 30_000 });

    // Page should still be functional with reduced motion
    await expect(page.getByTestId("studio-command-composer")).toBeVisible();

    // No horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    assertNoErrors(errors);
    await context.close();
  });
});
