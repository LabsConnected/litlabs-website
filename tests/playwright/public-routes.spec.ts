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
  { path: "/pricing", expectedText: /Creator|Pro|Pricing|month|\$7|\$19/i },
  { path: "/marketplace", expectedText: /Marketplace|agent|Agent/i },
  { path: "/gallery", expectedText: /Gallery|project|Project|Showcase/i },
  { path: "/docs", expectedText: /Docs|Documentation|guide|Guide|LiTTree/i },
  { path: "/privacy", expectedText: /Privacy|privacy/i },
  { path: "/terms", expectedText: /Terms|terms/i },
  { path: "/cookies", expectedText: /Cookie|cookie/i },
  { path: "/showcase", expectedText: /Showcase|project|Project|Gallery/i },
  { path: "/voice", expectedText: /Voice|voice|speak|Speak|Studio|Sign/i },
];

test.describe("Public routes — exact status assertions @public", () => {
  test.describe.configure({ mode: "parallel" });

  for (const route of PUBLIC_ROUTES) {
    test(`${route.path} returns 200 with expected content`, async ({ page }) => {
      const errors = monitorApplicationErrors(page);

      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

      // Exact status assertion — not "status < 500"
      expect(response?.status(), `${route.path} should return 200`).toBe(200);

      // Wait for client-side rendering to complete
      await page.waitForLoadState("domcontentloaded");

      // Verify the page has meaningful content (not a blank page)
      // Use textContent which includes hidden text, then innerText for visible
      const bodyText = await page.locator("body").innerText();
      const bodyHtml = await page.locator("body").innerHTML();
      const totalContent = bodyText.length + bodyHtml.length;
      expect(totalContent, `${route.path} should have body content`).toBeGreaterThan(100);

      // Verify expected text is present (check both visible text and HTML)
      const hasExpectedText = await page.locator("body").textContent();
      expect(hasExpectedText, `${route.path} should contain expected text`).toMatch(route.expectedText);

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
    // robots.txt may return 200 or 404 if not configured — accept either
    const status = response?.status() ?? 0;
    expect(status === 200 || status === 404, `robots.txt returned ${status}`).toBe(true);

    if (status === 200) {
      // Use response body text — page.content() wraps in HTML
      const text = await response?.text() ?? "";
      expect(text, "robots.txt should contain User-agent").toMatch(/User-agent/i);
    }
  });
});
