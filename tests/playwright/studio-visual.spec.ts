import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors, waitForPageReady } from "./helpers";

/**
 * Studio visual regression tests — Phase 10 shell components.
 *
 * Captures screenshots at each required viewport to verify:
 * - No horizontal document overflow
 * - No inaccessible controls
 * - No content hidden beneath composer/navigation
 * - No accidental double scroll regions
 * - No placeholder or prototype copy
 * - Consistent type, spacing, radius, and state colors
 *
 * Run `pnpm exec playwright test studio-visual.spec.ts --update-snapshots`
 * to generate baselines.
 *
 * Phase 10.8 — Visual gate
 */

const isRemoteUrl = !!(process.env.PLAYWRIGHT_BASE_URL || process.env.SMOKE_TEST_URL);

test.describe("Studio visual regression @studio @visual", () => {
  test.skip(isRemoteUrl, "Visual regression baselines are local/CI only");

  // ── Desktop: 1440×900 ──

  test("Studio shell — desktop 1440×900", async ({ page, browser }) => {
    const errors = monitorApplicationErrors(page);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ctxPage = await context.newPage();

    await ctxPage.goto("/studio");
    await waitForPageReady(ctxPage, { testId: "studio-command-composer", timeout: 30_000 });

    // No horizontal overflow
    const scrollWidth = await ctxPage.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await ctxPage.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await expect(ctxPage).toHaveScreenshot("studio-desktop-1440.png", {
      fullPage: false,
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
      mask: [
        ctxPage.locator("[data-testid='user-avatar']").filter({ hasText: "" }),
      ],
    });

    assertNoErrors(errors);
    await context.close();
  });

  // ── Laptop: 1280×800 ──

  test("Studio shell — laptop 1280×800", async ({ page, browser }) => {
    const errors = monitorApplicationErrors(page);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctxPage = await context.newPage();

    await ctxPage.goto("/studio");
    await waitForPageReady(ctxPage, { testId: "studio-command-composer", timeout: 30_000 });

    const scrollWidth = await ctxPage.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await ctxPage.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await expect(ctxPage).toHaveScreenshot("studio-laptop-1280.png", {
      fullPage: false,
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
      mask: [
        ctxPage.locator("[data-testid='user-avatar']").filter({ hasText: "" }),
      ],
    });

    assertNoErrors(errors);
    await context.close();
  });

  // ── Tablet: 768×1024 ──

  test("Studio shell — tablet 768×1024", async ({ page, browser }) => {
    const errors = monitorApplicationErrors(page);
    const context = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    const ctxPage = await context.newPage();

    await ctxPage.goto("/studio");
    await waitForPageReady(ctxPage, { testId: "studio-command-composer", timeout: 30_000 });

    const scrollWidth = await ctxPage.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await ctxPage.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await expect(ctxPage).toHaveScreenshot("studio-tablet-768.png", {
      fullPage: false,
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
      mask: [
        ctxPage.locator("[data-testid='user-avatar']").filter({ hasText: "" }),
      ],
    });

    assertNoErrors(errors);
    await context.close();
  });

  // ── Mobile: 390×844 ──

  test("Studio shell — mobile 390×844", async ({ page, browser }) => {
    const errors = monitorApplicationErrors(page);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ctxPage = await context.newPage();

    await ctxPage.goto("/studio");
    await waitForPageReady(ctxPage, { testId: "studio-command-composer", timeout: 30_000 });

    const scrollWidth = await ctxPage.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await ctxPage.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await expect(ctxPage).toHaveScreenshot("studio-mobile-390.png", {
      fullPage: false,
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
      mask: [
        ctxPage.locator("[data-testid='user-avatar']").filter({ hasText: "" }),
      ],
    });

    assertNoErrors(errors);
    await context.close();
  });

  // ── No horizontal overflow at all viewports ──

  test("No horizontal overflow at 360px", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await context.newPage();

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer", timeout: 30_000 });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await context.close();
  });

  test("No horizontal overflow at 1024px", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer", timeout: 30_000 });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await context.close();
  });

  test("No horizontal overflow at 1600px", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();

    await page.goto("/studio");
    await waitForPageReady(page, { testId: "studio-command-composer", timeout: 30_000 });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await context.close();
  });
});
