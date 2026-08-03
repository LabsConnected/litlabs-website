import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Public route tests — signed-out, exact status assertions.
 *
 * Every public route MUST return 200 with meaningful content.
 * No 404, no 307 redirect, no blank page, no loading screen.
 */

const PUBLIC_ROUTES = [
  { path: "/", expectedText: /LiTTree|LiTT|AI Creative Studio/i },
  { path: "/pricing", expectedText: /Creator|Pro|Pricing|month/i },
  { path: "/marketplace", expectedText: /Marketplace|agent|Agent/i },
  { path: "/gallery", expectedText: /Gallery|project|Project/i },
  { path: "/docs", expectedText: /Docs|Documentation|guide|Guide/i },
  { path: "/privacy", expectedText: /Privacy|privacy/i },
  { path: "/terms", expectedText: /Terms|terms/i },
  { path: "/cookies", expectedText: /Cookie|cookie/i },
  { path: "/showcase", expectedText: /Showcase|project|Project/i },
  { path: "/voice", expectedText: /Voice|voice|speak|Speak/i },
];

test.describe("Public routes — exact status assertions @public", () => {
  test.describe.configure({ mode: "parallel" });

  for (const route of PUBLIC_ROUTES) {
    test(`${route.path} returns 200 with expected content`, async ({ page }) => {
      const errors = monitorApplicationErrors(page);

      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

      // Exact status assertion — not "status < 500"
      expect(response?.status(), `${route.path} should return 200`).toBe(200);

      // Verify the page has meaningful content (not a blank page)
      const bodyText = await page.locator("body").innerText();
      expect(bodyText.length, `${route.path} should have body content`).toBeGreaterThan(100);

      // Verify expected text is present
      await expect(page.locator("body")).toContainText(route.expectedText, { timeout: 10_000 });

      assertNoErrors(errors);
    });
  }

  test("Homepage has correct meta tags", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    const title = await page.title();
    expect(title.length).toBeGreaterThan(5);
    expect(title.toLowerCase()).toContain("littree");

    const description = await page.getAttribute('meta[name="description"]', "content");
    expect(description).toBeTruthy();
    expect(description!.length).toBeGreaterThan(20);
  });

  test("Sitemap.xml is accessible", async ({ page }) => {
    const response = await page.goto("/sitemap.xml");
    expect(response?.status()).toBe(200);

    const content = await page.content();
    expect(content).toContain("<urlset");
  });

  test("robots.txt is accessible", async ({ page }) => {
    const response = await page.goto("/robots.txt");
    expect(response?.status()).toBe(200);

    const content = await page.content();
    expect(content).toContain("User-agent");
  });
});
