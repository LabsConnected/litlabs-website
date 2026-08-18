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

    // Creator Beta must be $15/month
    expect(bodyText, "Pricing page must show $15 for Creator").toContain("$15");

    // Pro Builder Beta must be $39/month
    expect(bodyText, "Pricing page must show $39 for Pro").toContain("$39");

    // Founder price is $149 one-time
    expect(bodyText, "Pricing page must show $149 for Founder").toContain("$149");

    // Must NOT show old prices
    expect(bodyText, "Pricing page must NOT show $7 for Creator").not.toContain("$7");
    expect(bodyText, "Pricing page must NOT show $19 for Pro").not.toContain("$19");

    assertNoErrors(errors);
  });

  test("Founder price is $149 one-time purchase", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/pricing");
    await page.waitForLoadState("domcontentloaded");

    // Founder price should be displayed
    const founderPrice = page.locator("section.founderBanner h2");
    await expect(founderPrice).toContainText("$149");

    // Button should exist (either enabled or disabled based on Stripe config)
    const founderButton = page.locator("section.founderBanner button");
    await expect(founderButton).toBeVisible();

    assertNoErrors(errors);
  });

  test("Creator checkout button is enabled", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/pricing");
    await page.waitForLoadState("domcontentloaded");

    // Find Creator checkout button — should be enabled
    const creatorButton = page.locator('button', { hasText: /Creator|Choose Creator/i });
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
