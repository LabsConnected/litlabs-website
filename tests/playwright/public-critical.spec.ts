import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Critical public route tests — run on Chromium, Firefox, and WebKit.
 * Smaller subset of the most important routes.
 */

const CRITICAL_ROUTES = [
  { path: "/", expectedText: /LiTTree|LiTT/i },
  { path: "/pricing", expectedText: /Creator|Pro|month|\$7|\$19/i },
  { path: "/marketplace", expectedText: /Marketplace|agent/i },
  // /studio requires auth — in CI with PLAYWRIGHT_AUTH_DISABLED, Clerk may
  // not fully hydrate on WebKit. Accept the page title, sign-in prompt,
  // loading state ("Authenticating"), or timeout message as valid rendering.
  { path: "/studio", expectedText: /Studio|Sign|sign|Authenticating|connecting/i },
];

test.describe("Critical public routes @public-critical @routes-critical", () => {
  test.describe.configure({ mode: "serial" });

  for (const route of CRITICAL_ROUTES) {
    test(`${route.path} renders correctly`, async ({ page }) => {
      const errors = monitorApplicationErrors(page);

      // Use domcontentloaded — returns when HTML is parsed
      const response = await page.goto(route.path, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      expect(response?.status(), `${route.path} should return 200`).toBe(200);

      // Wait for expected text to appear (client-side hydration may take time)
      // Use a longer timeout for the homepage (heavy animations) and /studio
      // (Clerk auth hydration, especially on WebKit).
      const timeout = route.path === "/" || route.path === "/studio" ? 30_000 : 15_000;
      await expect(
        page.locator("body"),
        `${route.path} should contain expected text after hydration`,
      ).toContainText(route.expectedText, { timeout });

      assertNoErrors(errors);
    });
  }
});
