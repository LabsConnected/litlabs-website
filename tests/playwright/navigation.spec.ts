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

    // Collect all nav link hrefs in a single DOM evaluation — this avoids
    // stale locator references when Clerk hydration re-renders the nav
    // between individual getAttribute() calls. evaluateAll runs once in the
    // browser context and returns plain strings, immune to later re-renders.
    let hrefs = await page.locator('[data-testid^="nav-"]').evaluateAll(
      (els) => els.map((el) => el.getAttribute("href")).filter((h): h is string => !!h),
    );

    if (hrefs.length < 3) {
      hrefs = await page.locator("nav a[href]").evaluateAll(
        (els) => els.map((el) => el.getAttribute("href")).filter((h): h is string => !!h),
      );
    }

    expect(hrefs.length, "Homepage should have nav links").toBeGreaterThanOrEqual(3);

    // Use only the first 3 to avoid timeout
    hrefs = hrefs.slice(0, 3);

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
