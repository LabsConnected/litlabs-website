import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Billing and LiTTBit tests — pricing, checkout, and wallet.
 */

test.describe("Billing @billing", () => {
  test("Pricing page shows correct plan prices", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/pricing");
    await page.waitForLoadState("domcontentloaded");

    const bodyText = await page.locator("body").innerText();

    // Creator Beta must be $7/month
    expect(bodyText, "Pricing page must show $7 for Creator").toContain("$7");

    // Pro Builder Beta must be $19/month
    expect(bodyText, "Pricing page must show $19 for Pro").toContain("$19");

    // Founder must show "Coming Soon"
    expect(bodyText, "Founder must show Coming Soon").toContain("Coming Soon");

    // Must NOT show $49 or $149 for Founder
    expect(bodyText, "Founder must NOT show $49").not.toContain("$49");
    expect(bodyText, "Founder must NOT show $149").not.toContain("$149");

    assertNoErrors(errors);
  });

  test("Founder checkout button is disabled", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/pricing");
    await page.waitForLoadState("domcontentloaded");

    // Find the Founder button
    const founderButton = page.locator("button", { hasText: "Coming Soon" });
    await expect(founderButton).toBeVisible();
    await expect(founderButton).toBeDisabled();

    assertNoErrors(errors);
  });

  test("Creator checkout button is enabled", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/pricing");
    await page.waitForLoadState("domcontentloaded");

    // Find Creator checkout button — should be enabled
    const creatorButton = page.locator("button", { hasText: /Creator|Start|Subscribe|Get/i }).first();
    if (await creatorButton.isVisible()) {
      await expect(creatorButton).toBeEnabled();
    }

    assertNoErrors(errors);
  });

  test("Wallet page redirects unauthenticated users to sign-in", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const response = await page.goto("/wallet");
    // Should redirect to sign-in (307)
    expect(response?.status()).toBe(307);

    const redirectUrl = page.url();
    expect(redirectUrl).toContain("/sign-in");
    expect(redirectUrl).toContain("redirect=");

    assertNoErrors(errors);
  });
});
