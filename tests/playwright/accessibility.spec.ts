import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

/**
 * Accessibility tests — WCAG A/AA compliance scans.
 *
 * Automated scans catch missing labels, duplicate IDs, contrast issues.
 * Manual testing is still needed for full accessibility compliance.
 */

const ACCESSIBILITY_ROUTES = [
  { path: "/", name: "Homepage" },
  { path: "/pricing", name: "Pricing" },
  { path: "/marketplace", name: "Marketplace" },
  { path: "/gallery", name: "Gallery" },
  { path: "/docs", name: "Docs" },
  { path: "/privacy", name: "Privacy" },
  { path: "/terms", name: "Terms" },
  { path: "/cookies", name: "Cookies" },
];

// Known false positives that require manual review or are third-party issues
const KNOWN_FALSE_POSITIVES = [
  "color-contrast", // Often flagged for dynamic themes — requires manual review
  "region", // Content may not always be in a landmark region
];

test.describe("Accessibility @public", () => {
  test.describe.configure({ mode: "parallel" });

  for (const route of ACCESSIBILITY_ROUTES) {
    test(`${route.name} (${route.path}) has no critical accessibility violations`, async ({ page }) => {
      await page.goto(route.path);
      await page.waitForLoadState("domcontentloaded");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      // Filter out known false positives
      const criticalViolations = results.violations.filter(
        (v) =>
          (v.impact === "critical" || v.impact === "serious") &&
          !KNOWN_FALSE_POSITIVES.includes(v.id),
      );

      expect(
        criticalViolations,
        `${route.name} has ${criticalViolations.length} critical/serious accessibility violations:\n${
          criticalViolations.map((v) => `- ${v.id}: ${v.description}`).join("\n")
        }`,
      ).toEqual([]);
    });
  }
});
