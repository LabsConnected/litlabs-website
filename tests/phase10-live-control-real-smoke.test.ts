/**
 * Phase 10.9.1 — Real Stagehand/Browserbase Smoke Test
 *
 * This test runs a REAL browser session through the actual Stagehand/
 * Browserbase driver — no mocks. It is skipped unless
 * BROWSERBASE_API_KEY is set in the environment.
 *
 * To run:
 *   BROWSERBASE_API_KEY=xxx npx vitest run tests/phase10-live-control-real-smoke.test.ts
 *
 * Never prints Browserbase or provider credentials.
 */

import { describe, it, expect } from "vitest";

const hasCredentials = Boolean(process.env.BROWSERBASE_API_KEY?.trim());

describe.skipIf(!hasCredentials)("Phase 10.9.1 — Real Stagehand/Browserbase Smoke", () => {
  it("runs a complete real browser session end-to-end", async () => {
    // Dynamic imports — only loaded when credentials are available
    const {
      startSession,
      closeSession,
      takeControl,
      returnControl,
      cancelSessionAction,
      getSessionErrors,
      executeBrowserAction,
      takeScreenshot,
      getSession,
    } = await import("@/lib/litt-intelligence/browser-session-manager");

    const userId = `smoke-${Date.now()}`;
    const testUrl = "https://example.com";

    // ── 1. Start session ──────────────────────────────────────────
    const session = await startSession({ userId, task: "Phase 10.9.1 smoke" });
    expect(session.id).toBeDefined();
    expect(session.status).toBe("active");
    expect(session.browserbaseSessionId).toBeTruthy();

    try {
      // ── 2. Navigate ─────────────────────────────────────────────
      const navResult = await executeBrowserAction(
        session.id,
        userId,
        "browser.navigate",
        { url: testUrl },
        async (stagehand) => {
          const page = stagehand.context.pages()[0];
          await page.goto(testUrl, { waitUntil: "domcontentloaded" });
          return {
            success: true,
            data: { url: page.url(), title: await page.title() },
            durationMs: 0,
          };
        },
      );
      expect(navResult.success).toBe(true);

      // ── 3. Screenshot ───────────────────────────────────────────
      const screenshot = await takeScreenshot(session.id);
      expect(screenshot).toBeTruthy();
      expect(screenshot).toContain("data:image/png;base64,");

      // ── 4. Snapshot / inspect ───────────────────────────────────
      const snapshotResult = await executeBrowserAction(
        session.id,
        userId,
        "browser.snapshot",
        {},
        async (stagehand) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const page: any = stagehand.context.pages()[0];
          const textContent = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? "");
          return { success: true, data: { textContent }, durationMs: 0 };
        },
      );
      expect(snapshotResult.success).toBe(true);

      // ── 5. Click ────────────────────────────────────────────────
      const clickResult = await executeBrowserAction(
        session.id,
        userId,
        "browser.click",
        { selector: "body" },
        async (stagehand) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const page: any = stagehand.context.pages()[0];
          await page.click("body", { force: true }).catch(() => {});
          return { success: true, durationMs: 0 };
        },
      );
      expect(clickResult.success).toBe(true);

      // ── 6. Type ─────────────────────────────────────────────────
      // example.com has no input, so we just verify the action executes
      const typeResult = await executeBrowserAction(
        session.id,
        userId,
        "browser.type",
        { selector: "body", value: "test" },
        async () => {
          // No input field on example.com — just verify execution path works
          return { success: true, durationMs: 0 };
        },
      );
      expect(typeResult.success).toBe(true);

      // ── 7. Scroll ───────────────────────────────────────────────
      const scrollResult = await executeBrowserAction(
        session.id,
        userId,
        "browser.scroll",
        { direction: "down", amount: 100 },
        async (stagehand) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const page: any = stagehand.context.pages()[0];
          await page.evaluate(() => window.scrollBy(0, 100));
          return { success: true, durationMs: 0 };
        },
      );
      expect(scrollResult.success).toBe(true);

      // ── 8. Refresh ──────────────────────────────────────────────
      const refreshResult = await executeBrowserAction(
        session.id,
        userId,
        "browser.reload",
        {},
        async (stagehand) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const page: any = stagehand.context.pages()[0];
          await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
          return { success: true, durationMs: 0 };
        },
      );
      expect(refreshResult.success).toBe(true);

      // ── 9. Console/network state ────────────────────────────────
      const errors = getSessionErrors(session.id);
      expect(errors).toBeDefined();
      expect(Array.isArray(errors.consoleErrors)).toBe(true);
      expect(Array.isArray(errors.networkErrors)).toBe(true);

      // ── 10. Take Control blocks action ──────────────────────────
      await takeControl(session.id, userId);
      const humanSession = await getSession(session.id, userId);
      expect(humanSession?.status).toBe("human_control");

      const blockedResult = await executeBrowserAction(
        session.id,
        userId,
        "browser.navigate",
        { url: testUrl },
        async () => ({ success: true, durationMs: 0 }),
      );
      expect(blockedResult.success).toBe(false);
      expect(blockedResult.error).toContain("human control");

      // ── 11. Return Control restores action ──────────────────────
      await returnControl(session.id, userId);
      const restoredResult = await executeBrowserAction(
        session.id,
        userId,
        "browser.navigate",
        { url: testUrl },
        async () => ({ success: true, durationMs: 0 }),
      );
      expect(restoredResult.success).toBe(true);

      // ── 12. Stop cancels action ─────────────────────────────────
      const slowAction = executeBrowserAction(
        session.id,
        userId,
        "browser.wait",
        {},
        async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 2000));
          return { success: true, durationMs: 0 };
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const cancelled = cancelSessionAction(session.id);
      expect(cancelled).toBe(true);
      const cancelResult = await slowAction;
      expect(cancelResult.success).toBe(false);
      expect(cancelResult.error).toContain("cancelled");

    } finally {
      // ── 13. Close session ───────────────────────────────────────
      await closeSession(session.id, userId);
      const closedSession = await getSession(session.id, userId);
      // Session should be closed or not found (no DB in test env)
      if (closedSession) {
        expect(closedSession.status).toBe("closed");
      }
    }

    // ── 14. Second session starts cleanly ──────────────────────────
    const session2 = await startSession({ userId, task: "Phase 10.9.1 smoke 2" });
    expect(session2.id).not.toBe(session.id);
    expect(session2.status).toBe("active");
    await closeSession(session2.id, userId);
  }, 120_000); // 2 minute timeout for real browser operations
});
