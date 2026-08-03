import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Navigation tests — verify all nav links work and no dead buttons exist.
 */

test.describe("Navigation @public", () => {
  test("Homepage nav links navigate to valid pages", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/");

    // Find all nav links with data-testid
    const navLinks = page.locator('[data-testid^="nav-"]');
    const count = await navLinks.count();

    // Must have at least 3 nav links — not silently passing if none found
    expect(count, "Homepage should have nav links with data-testid").toBeGreaterThanOrEqual(3);

    for (let i = 0; i < count; i++) {
      const link = navLinks.nth(i);
      const href = await link.getAttribute("href");
      expect(href, `Nav link ${i} must have an href`).toBeTruthy();

      // Navigate to the link
      await link.click();
      await page.waitForLoadState("domcontentloaded");

      const response = page.url();
      expect(response, `Nav link to ${href} should navigate`).not.toContain("/404");

      // Go back to homepage for next link
      await page.goBack();
      await page.waitForLoadState("domcontentloaded");
    }

    assertNoErrors(errors);
  });

  test("All visible links on homepage point to valid routes", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/");

    // Get all <a> tags with href
    const links = page.locator("a[href]");
    const count = await links.count();
    expect(count, "Homepage should have links").toBeGreaterThan(5);

    const hrefs = new Set<string>();
    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute("href");
      if (href && !href.startsWith("http") && !href.startsWith("mailto:") && !href.startsWith("#")) {
        hrefs.add(href);
      }
    }

    // Verify each internal link resolves to a 200 or 307 (auth redirect)
    for (const href of hrefs) {
      const response = await page.goto(href, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;
      expect(
        status === 200 || status === 307,
        `Link to ${href} returned ${status}`,
      ).toBe(true);
    }

    assertNoErrors(errors);
  });

  test("Footer links are not dead", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/");

    const footer = page.locator("footer");
    if (await footer.isVisible()) {
      const footerLinks = footer.locator("a[href]");
      const count = await footerLinks.count();

      for (let i = 0; i < count; i++) {
        const href = await footerLinks.nth(i).getAttribute("href");
        if (href && !href.startsWith("http") && !href.startsWith("mailto:")) {
          const response = await page.goto(href, { waitUntil: "domcontentloaded" });
          const status = response?.status() ?? 0;
          expect(
            status === 200 || status === 307,
            `Footer link to ${href} returned ${status}`,
          ).toBe(true);
          await page.goBack();
        }
      }
    }

    assertNoErrors(errors);
  });
});
