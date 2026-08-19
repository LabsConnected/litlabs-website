import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors } from "./helpers";

/**
 * Terminal page + API smoke tests.
 *
 * These tests cover the public-facing terminal behavior:
 *   1. /litt-terminal redirects to /studio (the terminal lives inside Studio)
 *   2. /api/terminal/token returns 401 when unauthenticated
 *   3. /api/terminal/history returns 401 when unauthenticated
 *   4. The Studio page (which contains the terminal) loads without 5xx errors
 *
 * Authenticated terminal flow (workspace prepare → socket.io → PTY session)
 * is covered by the Vitest smoke test in tests/terminal-server-smoke.test.ts,
 * which starts the real terminal server and verifies the full lifecycle.
 */

test.describe("Terminal — public behavior @public", () => {
  test.describe.configure({ mode: "parallel" });

  test("/litt-terminal redirects to /studio or sign-in", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    await page.goto("/litt-terminal");

    // /litt-terminal calls redirect("/studio"). In CI with auth disabled,
    // this lands on /studio. In production, /studio is protected so the
    // middleware further redirects to /sign-in. Both are valid.
    await page.waitForURL(/\/(studio|sign-in)/);
    const url = page.url();
    expect(url).toMatch(/\/(studio|sign-in)/);

    assertNoErrors(errors);
  });

  test("/api/terminal/token returns 401 when unauthenticated", async ({ request }) => {
    const resp = await request.get("/api/terminal/token");
    expect(resp.status()).toBe(401);

    const body = await resp.json().catch(() => ({}));
    expect(body.error).toBeTruthy();
  });

  test("/api/terminal/token?projectId=xxx returns 401 when unauthenticated", async ({ request }) => {
    const resp = await request.get("/api/terminal/token?projectId=test-project-123");
    expect(resp.status()).toBe(401);
  });

  test("/api/terminal/history returns 401 when unauthenticated", async ({ request }) => {
    const resp = await request.get("/api/terminal/history");
    expect(resp.status()).toBe(401);
  });

  test("Studio page loads or redirects to sign-in", async ({ page }) => {
    const errors = monitorApplicationErrors(page);

    const response = await page.goto("/studio", { waitUntil: "domcontentloaded" });
    // In CI with auth disabled, /studio returns 200. In production,
    // /studio is protected and redirects to /sign-in (307).
    const status = response?.status() ?? 0;
    expect(
      status === 200 || status === 307,
      `/studio should return 200 or redirect to sign-in, got ${status}`,
    ).toBe(true);

    // Wait for either the sign-in screen or studio UI to render
    await page.waitForLoadState("networkidle");

    const url = page.url();
    expect(url).toMatch(/\/(studio|sign-in)/);

    // The page should have some rendered content — use innerHTML which
    // includes rendered React content even if text is minimal (loading states)
    const bodyHtml = await page.locator("body").innerHTML();
    expect(bodyHtml.length).toBeGreaterThan(100);

    assertNoErrors(errors);
  });
});

test.describe("Terminal — workspace prepare API auth @public", () => {
  test("workspace prepare endpoint returns 401 when unauthenticated", async ({ request }) => {
    const resp = await request.post("/api/studio-projects/test-project/workspace/prepare", {
      data: {},
    });
    expect(resp.status()).toBe(401);
  });

  test("workspace status endpoint returns 401 when unauthenticated", async ({ request }) => {
    const resp = await request.get("/api/studio-projects/test-project/workspace");
    expect(resp.status()).toBe(401);
  });
});
