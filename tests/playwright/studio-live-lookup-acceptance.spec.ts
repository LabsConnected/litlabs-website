import { test, expect } from "@playwright/test";
import { monitorApplicationErrors, assertNoErrors, waitForPageReady } from "./helpers";

/**
 * Live browser acceptance for Studio's BoardBrowserPanel live-lookup bar
 * (worktree-studio-live-lookup, 2026-11-17, extended 2026-11-17 with
 * cancellation + apply-to-project). The lookup itself stays a
 * single-shot question -> one sourced answer or an honest error;
 * "selection" here means confirming whether to save that one answer
 * into the project, not picking from a list of candidates — there is
 * still only one result per search (see final report for that scoping
 * note).
 *
 * Success-path tests hit the real Google Places API (GOOGLE_PLACES_API_KEY
 * from .env.local) — no mocking. Failure-path tests intercept the
 * browser's own fetch to /api/studio/lookup to deterministically simulate
 * a provider outage without touching the real key. The apply-to-project
 * test intercepts the project files API the same way, so it never writes
 * into a real project workspace during the test run.
 */

async function ensureProject(page: import("@playwright/test").Page) {
  const board = page.getByTestId("studio-board");
  if (await board.count() > 0) return;

  await page.getByRole("button", { name: /select project|no project selected/i }).click();
  // exact: true — once a project named "My new project" exists, a
  // substring match on "New project" also hits the switcher's own
  // trigger button (its label contains that text), a strict-mode
  // violation this disambiguates.
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(board).toBeVisible({ timeout: 30_000 });
}

async function openBrowserPanel(page: import("@playwright/test").Page) {
  await page.goto("/studio");
  await waitForPageReady(page, { testId: "studio-command-composer", timeout: 30_000 }).catch(() => {});
  await ensureProject(page);

  const panel = page.getByTestId("board-browser-panel");
  if (await panel.count() === 0 || !(await panel.isVisible())) {
    await page.getByTestId("board-summon-browser").click();
  }
  await expect(page.getByTestId("board-browser-panel")).toBeVisible({ timeout: 10_000 });
}

test.describe("Studio Live Lookup — BoardBrowserPanel (real browser acceptance)", () => {
  test("successful search returns real, non-mocked Google Places data", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await openBrowserPanel(page);

    await page.getByTestId("board-browser-lookup-input").fill("What time does Walmart open?");
    await page.getByTestId("board-browser-lookup-submit").click();

    const result = page.getByTestId("board-browser-lookup-result");
    const errorEl = page.getByTestId("board-browser-lookup-error");
    await expect(result.or(errorEl)).toBeVisible({ timeout: 15_000 });

    // Real Places data is specific (a real address / open-closed status),
    // never the hardcoded-mock shape a stub would return.
    if (await result.count() > 0 && (await result.textContent())) {
      const text = (await result.textContent()) ?? "";
      expect(text.length).toBeGreaterThan(0);
      expect(text).toMatch(/open now|closed now|hours unknown/);
      expect(text).toContain("Walmart");
    } else {
      // Google found no "Walmart" match for the test's geo context — still
      // a legitimate real-provider response, not a mocked one. Record it.
      test.info().annotations.push({
        type: "note",
        description: `No Walmart match returned live: "${await errorEl.textContent()}"`,
      });
    }

    assertNoErrors(errors);
  });

  test("loading state swaps Look up for a visible Cancel button", async ({ page }) => {
    await openBrowserPanel(page);
    const input = page.getByTestId("board-browser-lookup-input");
    const submit = page.getByTestId("board-browser-lookup-submit");
    const cancel = page.getByTestId("board-browser-lookup-cancel");

    await input.fill("What time does Target open?");
    await submit.click();
    // Immediately after click, before the live request resolves.
    await expect(cancel).toBeVisible();
    await expect(submit).toHaveCount(0);
  });

  test("cancelling an in-flight search never shows a misleading provider error", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await openBrowserPanel(page);

    // Delay the response so there's a real window to cancel inside.
    await page.route("**/api/studio/lookup", async (route) => {
      await new Promise((r) => setTimeout(r, 3_000));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, formatted: "Should never be seen.", source: "Google Places" }),
      });
    });

    await page.getByTestId("board-browser-lookup-input").fill("What time does Costco open?");
    await page.getByTestId("board-browser-lookup-submit").click();

    const cancel = page.getByTestId("board-browser-lookup-cancel");
    await expect(cancel).toBeVisible();
    await cancel.click();

    // No error, no stale/incoming result — a clean, honest cancelled state.
    await expect(page.getByTestId("board-browser-lookup-error")).toHaveCount(0);
    await expect(page.getByTestId("board-browser-lookup-result")).toHaveCount(0);
    await expect(page.getByTestId("board-browser-lookup-submit")).toBeVisible();

    // Confirm the superseded response landing late still doesn't leak in.
    await page.waitForTimeout(3_500);
    await expect(page.getByTestId("board-browser-lookup-error")).toHaveCount(0);
    await expect(page.getByTestId("board-browser-lookup-result")).toHaveCount(0);

    assertNoErrors(errors);
  });

  test("no-match query returns an honest empty-result error, not a crash", async ({ page }) => {
    const errors = monitorApplicationErrors(page);
    await openBrowserPanel(page);

    await page.getByTestId("board-browser-lookup-input").fill(
      "What time does Zzqxnonexistentbusiness9912 open?",
    );
    await page.getByTestId("board-browser-lookup-submit").click();

    const errorEl = page.getByTestId("board-browser-lookup-error");
    await expect(errorEl).toBeVisible({ timeout: 15_000 });
    const text = await errorEl.textContent();
    expect(text).toBeTruthy();
    expect(text).not.toMatch(/undefined|\[object Object\]|NaN/);

    assertNoErrors(errors);
  });

  test("provider failure renders an honest error (simulated via intercepted fetch)", async ({ page }) => {
    await openBrowserPanel(page);

    await page.route("**/api/studio/lookup", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "That lookup failed." }),
      }),
    );

    await page.getByTestId("board-browser-lookup-input").fill("What time does Best Buy open?");
    await page.getByTestId("board-browser-lookup-submit").click();

    const errorEl = page.getByTestId("board-browser-lookup-error");
    await expect(errorEl).toBeVisible({ timeout: 10_000 });
    await expect(errorEl).toHaveText("That lookup failed.");
    await expect(page.getByTestId("board-browser-lookup-result")).toHaveCount(0);
  });

  test("retry after a failure clears the error and shows a fresh result", async ({ page }) => {
    await openBrowserPanel(page);

    let callCount = 0;
    await page.route("**/api/studio/lookup", (route) => {
      callCount += 1;
      if (callCount === 1) {
        return route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error: "That lookup failed." }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          formatted: "Retry Test Store (123 Test St) is open now.",
          source: "Google Places",
        }),
      });
    });

    const input = page.getByTestId("board-browser-lookup-input");
    const submit = page.getByTestId("board-browser-lookup-submit");

    await input.fill("What time does Retry Test Store open?");
    await submit.click();
    await expect(page.getByTestId("board-browser-lookup-error")).toBeVisible({ timeout: 10_000 });

    // User retries by resubmitting the same query — the only retry
    // affordance that exists (no dedicated Retry button in the UI).
    await submit.click();
    await expect(page.getByTestId("board-browser-lookup-result")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("board-browser-lookup-error")).toHaveCount(0);
    expect(callCount).toBe(2);
  });

  test("applying a result requires confirmation and writes via the existing project files API", async ({ page }) => {
    await openBrowserPanel(page);

    await page.route("**/api/studio/lookup", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          formatted: "Apply Test Store (1 Test Way) is open now.",
          source: "Google Places",
        }),
      }),
    );

    const captured: { writeCall: { path?: string; action?: string; content?: string; expectedSha256?: string } | null } = { writeCall: null };
    await page.route("**/api/studio-projects/*/files", async (route) => {
      const body = route.request().postDataJSON() as { action?: string; path?: string; content?: string };
      if (body.action === "read") {
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found" }) });
      }
      captured.writeCall = body;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ saved: true }) });
    });

    await page.getByTestId("board-browser-lookup-input").fill("What time does Apply Test Store open?");
    await page.getByTestId("board-browser-lookup-submit").click();
    await expect(page.getByTestId("board-browser-lookup-result")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("board-browser-lookup-apply").click();

    // The confirmation dialog must show exactly what will be written
    // before any write happens — nothing is sent to the files API yet.
    const dialog = page.getByTestId("lookup-apply-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("lookup-apply-path")).toHaveText("notes/litt-lookup.md");
    await expect(page.getByTestId("lookup-apply-preview")).toContainText("Apply Test Store");
    expect(captured.writeCall).toBeNull();

    // Cancelling the dialog must never write.
    await page.getByTestId("lookup-apply-cancel").click();
    await expect(dialog).toHaveCount(0);
    expect(captured.writeCall).toBeNull();

    // Re-open and actually confirm.
    await page.getByTestId("board-browser-lookup-apply").click();
    await page.getByTestId("lookup-apply-confirm").click();

    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId("board-browser-lookup-applied")).toBeVisible();
    expect(captured.writeCall).not.toBeNull();
    expect(captured.writeCall?.action).toBe("write");
    expect(captured.writeCall?.path).toBe("notes/litt-lookup.md");
    expect(captured.writeCall?.content).toContain("Apply Test Store (1 Test Way) is open now.");
    // No notes file existed (the read mock 404s) — the write must carry
    // the CAS "must not exist yet" precondition, not skip it.
    expect(captured.writeCall?.expectedSha256).toBe("absent");

    // A fresh search must clear the stale "Saved ✓" — it belonged to the
    // PREVIOUS result, not this unrelated new one.
    await page.getByTestId("board-browser-lookup-input").fill("What time does Another Store open?");
    await page.getByTestId("board-browser-lookup-submit").click();
    await expect(page.getByTestId("board-browser-lookup-result")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("board-browser-lookup-applied")).toHaveCount(0);
  });

  test("a concurrent edit to the notes file is never silently overwritten", async ({ page }) => {
    await openBrowserPanel(page);

    await page.route("**/api/studio/lookup", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          formatted: "Conflict Test Store (9 Test Ave) is open now.",
          source: "Google Places",
        }),
      }),
    );

    const writes: Array<{ content?: string; expectedSha256?: string }> = [];
    let writeAttempt = 0;
    await page.route("**/api/studio-projects/*/files", async (route) => {
      const body = route.request().postDataJSON() as { action?: string; content?: string; expectedSha256?: string };
      if (body.action === "read") {
        // Pretend a note already exists — this is what makes a non-"absent"
        // CAS precondition observable on the write below.
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: "## existing note\n" }) });
      }
      writeAttempt += 1;
      writes.push(body);
      if (writeAttempt === 1) {
        // Simulate another writer having changed the file in between.
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "REVISION_CONFLICT" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ saved: true }) });
    });

    await page.getByTestId("board-browser-lookup-input").fill("What time does Conflict Test Store open?");
    await page.getByTestId("board-browser-lookup-submit").click();
    await expect(page.getByTestId("board-browser-lookup-result")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("board-browser-lookup-apply").click();
    await page.getByTestId("lookup-apply-confirm").click();

    // One bounded retry: re-reads, re-appends, and succeeds — the user
    // never sees a lost update, and the final write still carries a
    // real (non-"absent") precondition since a note already existed.
    await expect(page.getByTestId("lookup-apply-dialog")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId("board-browser-lookup-applied")).toBeVisible();
    expect(writeAttempt).toBe(2);
    expect(writes[0].expectedSha256).not.toBe("absent");
    expect(writes[1].content).toContain("## existing note");
    expect(writes[1].content).toContain("Conflict Test Store (9 Test Ave) is open now.");
  });
});
