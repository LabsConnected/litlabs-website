import { test, expect } from "@playwright/test";

/**
 * Issue #602 — dead short aliases must redirect, never 404.
 * Public project (no Clerk). Follow-through landing pages may require auth
 * after the redirect; we only assert the first hop.
 */

const ALIASES: Array<{ from: string; to: RegExp }> = [
  { from: "/assets", to: /\/studio\?tool=assets/ },
  { from: "/missions", to: /\/studio\?tool=workflows/ },
  { from: "/files", to: /\/library\/files/ },
  { from: "/saved", to: /\/library\/saved/ },
  { from: "/connections", to: /\/settings\/connections/ },
];

test.describe("P0 navigation aliases @public", () => {
  test.describe.configure({ mode: "parallel" });

  for (const alias of ALIASES) {
    test(`${alias.from} redirects to a valid destination (not 404)`, async ({
      request,
    }) => {
      const res = await request.get(alias.from, { maxRedirects: 0 });
      expect(
        res.status(),
        `${alias.from} must redirect, got ${res.status()}`,
      ).toBeGreaterThanOrEqual(300);
      expect(res.status()).toBeLessThan(400);
      const location = res.headers()["location"] ?? "";
      expect(location, `${alias.from} Location`).toMatch(alias.to);
    });
  }

  test("/agents is 200 and does not 404", async ({ request }) => {
    const res = await request.get("/agents", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
  });
});

test.describe("P0 starter grant copy @public", () => {
  test("/agents signed-out copy still invites sign-in", async ({ page }) => {
    await page.goto("/agents", { waitUntil: "domcontentloaded" });
    const note = page.getByTestId("agents-session-note");
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(note).toContainText(/Sign in or create an account/i);
  });
});
