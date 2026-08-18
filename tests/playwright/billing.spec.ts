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

    // Founder banner is an <article> (not <section>) and its class is a
    // CSS-module hash, so we locate it by its unique text content instead
    // of styling/class-name coupling. "Founding Member" only appears in
    // the Founder banner article (FAQ uses <details>, not <article>).
    const founderArticle = page
      .locator("article")
      .filter({ hasText: "Founding Member" });

    // Founder price heading — the only <h2> on the page containing "$149"
    const founderPrice = founderArticle.getByRole("heading", { level: 2 });
    await expect(founderPrice).toContainText("$149");

    // Button should exist (either enabled or disabled based on Stripe config)
    const founderButton = founderArticle.getByRole("button");
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

    // Prove the USER-VISIBLE contract: an unauthenticated visitor to
    // /wallet must end up on /sign-in with a redirect= param. We do NOT
    // assert the intermediate HTTP 307 status because Playwright's browser
    // navigation may follow redirects (the final response seen by the
    // browser is the sign-in page's 200, not the 307). The product
    // contract is the final URL, not the redirect status code.
    await page.goto("/wallet");
    await page.waitForLoadState("domcontentloaded");

    const finalUrl = page.url();
    expect(finalUrl, "unauthenticated /wallet must end at /sign-in").toContain("/sign-in");
    expect(finalUrl, "sign-in redirect must carry a redirect= param").toContain("redirect=");

    assertNoErrors(errors);
  });
});
