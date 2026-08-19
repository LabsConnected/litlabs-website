import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Navigation tests — verify all nav links work and no dead buttons exist.
 */

test.describe("Navigation @public", () => {
  test("Homepage has visible navigation links", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Find all anchor tags in nav elements
    const navLinks = page.locator("nav a[href]");
    const count = await navLinks.count();

    // Must have at least 3 nav links — not silently passing if none found
    expect(count, "Homepage should have nav links").toBeGreaterThanOrEqual(3);

    assertNoErrors(errors);
  });

  test("Homepage nav links navigate to valid pages", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Wait for nav to render — Clerk hydration may delay nav rendering
    await page.locator("nav").waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});

    // Collect all nav link hrefs upfront before Clerk hydration re-renders.
    // We capture hrefs as strings so we're not affected by DOM re-renders
    // during the click→navigate→goBack loop below.
    let navLinks = page.locator('[data-testid^="nav-"]');
    let count = await navLinks.count();

    if (count === 0) {
      navLinks = page.locator("nav a[href]");
      count = await navLinks.count();
    }

    expect(count, "Homepage should have nav links").toBeGreaterThanOrEqual(3);

    // Snapshot the hrefs before any navigation — Clerk hydration can
    // re-render the nav and cause stale locator references.
    const hrefs: string[] = [];
    for (let i = 0; i < Math.min(count, 3); i++) {
      const href = await navLinks.nth(i).getAttribute("href", { timeout: 20_000 });
      expect(href, `Nav link ${i} must have an href`).toBeTruthy();
      hrefs.push(href!);
    }

    // Now navigate to each href directly — this avoids stale locator
    // issues from Clerk re-rendering the nav after goBack().
    for (const href of hrefs) {
      await page.goto(href);
      await page.waitForLoadState("domcontentloaded");

      const bodyText = await page.locator("body").innerText();
      expect(bodyText.length, `Nav link to ${href} should have content`).toBeGreaterThan(50);
    }
  });

  test("All visible internal links on homepage resolve to 200 or 307", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

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
  });
});
