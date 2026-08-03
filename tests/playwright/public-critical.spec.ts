import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Critical public route tests — run on Chromium, Firefox, and WebKit.
 * Smaller subset of the most important routes.
 */

const CRITICAL_ROUTES = [
  { path: "/", expectedText: /LiTTree|LiTT/i },
  { path: "/pricing", expectedText: /Creator|Pro|month/i },
  { path: "/marketplace", expectedText: /Marketplace|agent/i },
  { path: "/studio", expectedText: /Studio|Sign|sign/i },
];

test.describe("Critical public routes @public-critical @routes-critical", () => {
  for (const route of CRITICAL_ROUTES) {
    test(`${route.path} renders correctly`, async ({ page }) => {
      const errors = monitorApplicationErrors(page);

      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${route.path} should return 200`).toBe(200);

      const bodyText = await page.locator("body").innerText();
      expect(bodyText.length).toBeGreaterThan(50);

      await expect(page.locator("body")).toContainText(route.expectedText);

      assertNoErrors(errors);
    });
  }
});
