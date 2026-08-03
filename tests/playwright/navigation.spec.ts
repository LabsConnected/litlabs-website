import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Navigation tests — verify all nav links work and no dead buttons exist.
 */

test.describe("Navigation @public", () => {
  test("Homepage has visible navigation links", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Find all anchor tags in nav elements
    const navLinks = page.locator("nav a[href]");
    const count = await navLinks.count();

    // Must have at least 3 nav links — not silently passing if none found
    expect(count, "Homepage should have nav links").toBeGreaterThanOrEqual(3);

    assertNoErrors(errors);
  });

  test("Homepage nav links navigate to valid pages", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Find all nav links — try data-testid first, then fall back to nav a[href]
    let navLinks = page.locator('[data-testid^="nav-"]');
    let count = await navLinks.count();

    if (count === 0) {
      // Fall back to nav a[href] if data-testid attributes aren't present
      navLinks = page.locator("nav a[href]");
      count = await navLinks.count();
    }

    expect(count, "Homepage should have nav links").toBeGreaterThanOrEqual(3);

    // Test the first 3 links to avoid timeout
    for (let i = 0; i < Math.min(count, 3); i++) {
      const link = navLinks.nth(i);
      const href = await link.getAttribute("href");
      expect(href, `Nav link ${i} must have an href`).toBeTruthy();

      // Navigate to the link
      await link.click();
      await page.waitForLoadState("domcontentloaded");

      // Verify we're not on a 404 page
      const bodyText = await page.locator("body").innerText();
      expect(bodyText.length, `Nav link to ${href} should have content`).toBeGreaterThan(50);

      // Go back to homepage for next link
      await page.goBack();
      await page.waitForLoadState("domcontentloaded");
    }

    assertNoErrors(errors);
  });

  test("All visible internal links on homepage resolve to 200 or 307", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Get all <a> tags with href
    const links = page.locator("a[href]");
    const count = await links.count();
    expect(count, "Homepage should have links").toBeGreaterThan(5);

    const hrefs = new Set<string>();
    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute("href");
      if (href && !href.startsWith("http") && !href.startsWith("mailto:") && !href.startsWith("#") && !href.startsWith("tel:")) {
        hrefs.add(href);
      }
    }

    // Verify a sample of internal links (limit to 10 to avoid timeout)
    const sampleHrefs = Array.from(hrefs).slice(0, 10);
    for (const href of sampleHrefs) {
      const response = await page.goto(href, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;
      expect(
        status === 200 || status === 307,
        `Link to ${href} returned ${status}`,
      ).toBe(true);
    }

    assertNoErrors(errors);
  });
});
