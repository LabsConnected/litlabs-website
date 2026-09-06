import { test, expect } from "@playwright/test";

/**
 * Regression coverage for the production auth-401 investigation.
 *
 * Root cause: WalletProvider (WalletContext) and ProfileProvider
 * (ProfileContext) mount in the (marketing) layout on every public page
 * and fired authenticated API requests on mount WITHOUT waiting for
 * Clerk to report isSignedIn. This generated spurious 401s on every
 * page load for anonymous visitors and during the auth-resolution
 * window for stale sessions.
 *
 * Fix: gate /api/wallet and /api/settings/profile calls on
 * isSignedIn / accountUserId so they only fire for authenticated users.
 *
 * This test verifies that an anonymous visitor to a public page never
 * triggers authenticated API endpoints. It does NOT weaken server-side
 * auth — the server still enforces 401; we only assert the client no
 * longer fires the requests when it knows there is no session.
 */

const AUTHED_API_PATTERNS = [
  /\/api\/wallet(\?|$)/,
  /\/api\/settings\/profile(\?|$)/,
  /\/api\/account(\?|$)/,
  /\/api\/user\/ensure(\?|$)/,
  /\/api\/affiliate\/track-lead(\?|$)/,
];

test.describe("Auth-gating: anonymous visitors don't fire authenticated APIs @public", () => {
  test.describe.configure({ mode: "parallel" });

  for (const route of ["/", "/pricing", "/marketplace"]) {
    test(`${route} does not call authenticated APIs when signed out`, async ({ page }) => {
      const authedCalls: string[] = [];

      page.on("request", (req) => {
        const url = req.url();
        if (AUTHED_API_PATTERNS.some((p) => p.test(url))) {
          authedCalls.push(`${req.method()} ${url}`);
        }
      });

      await page.goto(route, { waitUntil: "domcontentloaded" });

      // Wait for Clerk to finish initializing + the 2s debounced profile
      // save window to elapse (the previous bug fired a POST after 2s).
      try {
        await page.waitForLoadState("networkidle", { timeout: 15000 });
      } catch {
        // networkidle may not fire on pages with long-lived connections;
        // the explicit timeout below covers the debounce window.
      }
      await page.waitForTimeout(3500);

      expect(
        authedCalls,
        "authenticated API endpoints must not be called for anonymous visitors",
      ).toEqual([]);
    });
  }

  test("signed-out landing page does not produce 401s on app APIs", async ({ page }) => {
    const four01s: string[] = [];

    page.on("response", (res) => {
      if (res.status() === 401) {
        four01s.push(`${res.request().method()} ${res.url()}`);
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch {
      // continue
    }
    await page.waitForTimeout(3500);

    // Filter to only app API 401s (ignore Clerk's own handshake/telemetry).
    const appApi401s = four01s.filter((u) => u.includes("/api/"));
    expect(
      appApi401s,
      "no app API should return 401 for an anonymous visitor on the landing page",
    ).toEqual([]);
  });
});
