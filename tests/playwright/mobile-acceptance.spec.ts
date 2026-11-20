import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const PRIMARY_VIEWPORT = { width: 390, height: 844 };
const KEYBOARD_VIEWPORT = { width: 390, height: 500 };
const TYPED_TEXT = "Build me a responsive landing page";

type Rect = { x: number; y: number; width: number; height: number };

function bottom(rect: Rect): number {
  return rect.y + rect.height;
}

function right(rect: Rect): number {
  return rect.x + rect.width;
}

async function visibleRect(locator: Locator, label: string): Promise<Rect> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const rect = await locator.boundingBox();
  expect(rect, `${label} should have measurable geometry`).not.toBeNull();
  return rect!;
}

function expectWithinViewport(rect: Rect, viewport: Rect, label: string): void {
  expect(right(rect), `${label} right edge should be inside the visual viewport`).toBeGreaterThan(0);
  expect(rect.x, `${label} left edge should be inside the visual viewport`).toBeLessThan(viewport.width);
  expect(bottom(rect), `${label} bottom edge should be inside the visual viewport`).toBeGreaterThan(0);
  expect(rect.y, `${label} top edge should be inside the visual viewport`).toBeLessThan(viewport.height);
  expect(rect.x, `${label} should not be clipped on the left`).toBeGreaterThanOrEqual(0);
  expect(right(rect), `${label} should not be clipped on the right`).toBeLessThanOrEqual(viewport.width);
  expect(rect.y, `${label} should not be clipped above the viewport`).toBeGreaterThanOrEqual(0);
  expect(bottom(rect), `${label} should not be hidden below the viewport`).toBeLessThanOrEqual(viewport.height);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const directory = path.join("test-results", "studio-mobile-acceptance", testInfo.project.name);
  await mkdir(directory, { recursive: true });
  const screenshotPath = path.join(directory, `${name}.png`);
  await page.screenshot({ path: screenshotPath, animations: "disabled" });
  await testInfo.attach(name, { path: screenshotPath, contentType: "image/png" });
}

async function measureOpenSheet(page: Page) {
  const sheet = await visibleRect(page.getByTestId("litt-mobile-sheet"), "LiTT mobile sheet");
  const composer = await visibleRect(page.getByTestId("studio-command-composer"), "chat composer");
  const input = await visibleRect(page.getByTestId("studio-command-input"), "message textarea");
  const action = await visibleRect(page.getByTestId("studio-send-button"), "Send/Cancel control");
  const topbar = await visibleRect(page.getByTestId("mobile-studio-topbar"), "mobile studio top bar");
  const viewport = await page.evaluate(() => ({
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }));

  expectWithinViewport(sheet, viewport, "LiTT mobile sheet");
  expectWithinViewport(composer, viewport, "chat composer");
  expectWithinViewport(input, viewport, "message textarea");
  expectWithinViewport(action, viewport, "Send/Cancel control");
  expectWithinViewport(topbar, viewport, "mobile studio top bar");
  expect(viewport.documentScrollWidth, "page should have no horizontal overflow").toBeLessThanOrEqual(
    viewport.documentClientWidth + 1,
  );
  // Chat-first layout (2026-11-19 card): the sheet is the home surface —
  // it fills the whole visual viewport and its own slim header (project
  // name + New Chat + menu) IS the top bar while chat is open. The
  // studio top bar underneath only becomes visible on tool surfaces,
  // where it leads with Back to chat. No bottom navigation dock exists.
  expect(sheet.y, "sheet should reach the top of the visual viewport").toBe(0);
  expect(bottom(sheet), "sheet should reach the bottom of the visual viewport").toBeGreaterThanOrEqual(
    viewport.height - 2,
  );
  await expect(
    page.getByTestId("litt-mobile-topbar"),
    "sheet should carry the slim chat-home header",
  ).toBeVisible();

  return { viewport, sheet, composer, input, action, topbar };
}

test.describe("LiTT Studio mobile acceptance", () => {
  test("authenticated chat remains reachable with simulated Android keyboard", async ({ page }, testInfo) => {
    await page.setViewportSize(PRIMARY_VIEWPORT);

    const response = await page.goto("/studio", { waitUntil: "domcontentloaded", timeout: 90_000 });
    expect(response?.status(), "authenticated Studio navigation should return 200").toBe(200);
    await expect(page).toHaveURL(/\/studio(?:[/?#]|$)/);

    if (process.env.PLAYWRIGHT_DEV_SERVER === "true") {
      await page.waitForFunction(
        () => Boolean(
          (window as Window & { Clerk?: { loaded?: boolean; user?: { id?: string } | null } }).Clerk?.loaded &&
          (window as Window & { Clerk?: { user?: { id?: string } | null } }).Clerk?.user?.id,
        ),
        undefined,
        { timeout: 30_000 },
      );
      const clerkUserId = await page.evaluate(
        () => (window as Window & { Clerk?: { user?: { id?: string } | null } }).Clerk?.user?.id,
      );
      expect(clerkUserId, "Clerk client session should remain authenticated on Studio").toBeTruthy();
    } else {
      const authProbe = await page.request.get("/api/studio-projects", { timeout: 60_000 });
      expect([401, 403], "Studio API should recognize the authenticated session").not.toContain(authProbe.status());
    }

    await expect(page.locator(".studio-shell")).toBeVisible({ timeout: 30_000 });
    // Chat-first layout: the chat sheet IS the home surface — it is open
    // on entry, no trigger/FAB/bottom-nav to discover first.
    await expect(page.getByTestId("litt-mobile-sheet")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("mobile-studio-topbar")).toBeVisible();
    await expect(page.getByTestId("studio-loading")).not.toBeVisible();
    await screenshot(page, testInfo, "A-initial-authenticated-studio-390x844");

    const initialPosition = await page.evaluate(() => ({
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(initialPosition.scrollX, "chat should be reachable without horizontal scrolling").toBe(0);
    expect(initialPosition.scrollY, "chat should be reachable without vertical scrolling").toBe(0);
    expect(initialPosition.scrollWidth, "initial Studio should have no horizontal overflow").toBeLessThanOrEqual(
      initialPosition.clientWidth + 1,
    );
    await screenshot(page, testInfo, "B-chat-home-visible-without-scrolling");

    await expect(page.getByTestId("litt-mobile-chat-panel")).toHaveAttribute("data-active", "true");
    // Mobile density redesign: the composer context line moved into the slim
    // sheet header row; the old persistent context line is hidden on mobile.
    await expect(page.getByTestId("studio-workspace-context")).toBeHidden();
    await expect(page.getByTestId("litt-mobile-project-name")).toBeVisible();
    await expect(page.getByTestId("studio-command-input")).toBeVisible();
    await expect(page.getByTestId("studio-send-button")).toHaveAttribute("aria-label", /^(Send message|Cancel response)$/);
    const initialGeometry = await measureOpenSheet(page);
    await screenshot(page, testInfo, "C-chat-sheet-open");

    const input = page.getByTestId("studio-command-input");
    await input.focus();
    await expect(input).toBeFocused();
    await input.fill(TYPED_TEXT);
    await expect(input).toHaveValue(TYPED_TEXT);
    await expect(page.getByTestId("studio-send-button")).toBeEnabled();
    await screenshot(page, testInfo, "D-textarea-focused-with-text");

    await page.setViewportSize(KEYBOARD_VIEWPORT);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(TYPED_TEXT);
    const keyboardGeometry = await measureOpenSheet(page);
    await screenshot(page, testInfo, "E-simulated-android-keyboard-390x500");

    const measurementDirectory = path.join("test-results", "studio-mobile-acceptance", testInfo.project.name);
    const measurementPath = path.join(measurementDirectory, "measurements.json");
    await writeFile(
      measurementPath,
      `${JSON.stringify({ primary: initialGeometry, keyboard: keyboardGeometry }, null, 2)}\n`,
      "utf8",
    );
    await testInfo.attach("geometry-measurements", { path: measurementPath, contentType: "application/json" });

    await page.setViewportSize(PRIMARY_VIEWPORT);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(TYPED_TEXT);

    // Chat-first layout: a tool surface takes the phone via the top-bar
    // menu, and Back to chat returns — the sheet stays mounted (hidden)
    // in between so drafts and streams survive.
    await page.getByTestId("litt-mobile-tools-button").click();
    await expect(page.getByTestId("mobile-tools-dialog")).toBeVisible();
    await page.getByTestId("mobile-tool-preview").click();
    await expect(page.getByTestId("litt-mobile-sheet")).toBeHidden();
    await expect(page.getByTestId("mobile-back-to-chat")).toBeVisible();
    await screenshot(page, testInfo, "F-tool-surface-back-to-chat");
    await page.getByTestId("mobile-back-to-chat").click();
    await expect(page.getByTestId("litt-mobile-sheet")).toBeVisible();
    await expect(page.getByTestId("studio-command-input")).toHaveValue(TYPED_TEXT);

    // The developer drawer is now a full-screen mobile surface; it must
    // not cover chat while closed, and Back to chat must release it.
    const collapsedDeveloperTools = page.getByTestId("dock-collapsed-toggle");
    if (await collapsedDeveloperTools.count() > 0 && await collapsedDeveloperTools.isVisible()) {
      await page.getByTestId("litt-mobile-tools-button").click();
      await page.getByTestId("mobile-tool-terminal").click();
      await expect(page.getByTestId("mobile-dock-overlay")).toBeVisible();
      await page.getByTestId("mobile-back-to-chat").click();
      await expect(page.getByTestId("mobile-dock-overlay")).toHaveCount(0);
      await expect(page.getByTestId("litt-mobile-sheet")).toBeVisible();
    }

    // Everything else stays behind the one menu button — no bottom nav,
    // no floating switcher, no FAB.
    await expect(page.locator('nav[aria-label="Studio navigation"]')).toHaveCount(0);
    await expect(page.getByTestId("mobile-surface-switcher")).toHaveCount(0);
    await screenshot(page, testInfo, "G-chat-home-final");
  });
});

test.describe("LiTT Studio mobile density redesign", () => {
  for (const width of [360, 390, 670, 768]) {
    test(`density geometry at ${width}px — chat dominates, cards collapsed`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });

      const response = await page.goto("/studio", { waitUntil: "domcontentloaded", timeout: 90_000 });
      expect(response?.status(), "authenticated Studio navigation should return 200").toBe(200);
      await expect(page).toHaveURL(/\/studio(?:[/?#]|$)/);
      await expect(page.locator(".studio-shell")).toBeVisible({ timeout: 30_000 });
      // Chat is the home surface — already open on entry.
      await expect(page.getByTestId("litt-mobile-sheet")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("studio-loading")).not.toBeVisible();
      await expect(page.getByTestId("litt-mobile-chat-panel")).toHaveAttribute("data-active", "true");

      // 1. Mission / Checkpoints / Next Actions cards must NOT dominate the
      // primary mobile flow anymore.
      for (const card of ["mission-card-mission", "mission-card-checkpoints", "mission-card-actions"]) {
        expect(
          await page.getByTestId(card).count(),
          `${card} should not render in the mobile chat primary flow`,
        ).toBe(0);
      }

      // 2. One compact Build status bar replaces the stack; ≤48px tall.
      const statusBar = page.getByTestId("mobile-build-status");
      await expect(statusBar, "Build status bar should be visible").toBeVisible();
      const statusRect = await visibleRect(statusBar, "Build status bar");
      expect(statusRect.height, "Build status bar should be compact (≤48px)").toBeLessThanOrEqual(48);

      // 3. Conversation + composer are the dominant surfaces. A fresh
      // conversation shows the empty state instead of a transcript —
      // either way the chat column owns the viewport.
      const transcript = page.getByTestId("studio-transcript");
      const emptyState = page.getByTestId("empty-state");
      const chatSurface = (await transcript.count()) > 0 ? transcript : emptyState;
      await expect(chatSurface, "chat surface (transcript or empty state) should be visible").toBeVisible();
      const chatPanelRect = await visibleRect(
        page.getByTestId("litt-mobile-chat-panel"),
        "mobile chat panel",
      );
      const viewportHeight = 844;
      expect(
        chatPanelRect.height,
        "chat panel should occupy the majority of the first viewport",
      ).toBeGreaterThan(viewportHeight / 2);

      const composer = page.getByTestId("studio-command-composer");
      await expect(composer, "composer should be visible").toBeVisible();
      const composerRect = await visibleRect(composer, "composer");
      expect(
        composerRect.height,
        "composer should be slim in its empty state (<200px)",
      ).toBeLessThan(200);

      // 4. Download pills live in an overflow menu, not the primary flow.
      // (Only present when the conversation has downloadable messages.)
      if ((await page.getByTestId("transcript-overflow").count()) > 0) {
        expect(
          await page.getByTestId("download-txt").count(),
          "Download .txt pill should be hidden until the overflow opens",
        ).toBe(0);
        expect(
          await page.getByTestId("download-md").count(),
          "Download .md pill should be hidden until the overflow opens",
        ).toBe(0);
        await page.getByTestId("transcript-overflow").click();
        await expect(page.getByTestId("download-txt"), "Download .txt should appear in the overflow menu").toBeVisible();
        await expect(page.getByTestId("download-md"), "Download .md should appear in the overflow menu").toBeVisible();
      }

      // 5. Tools sheet entry point is reachable from the sheet header.
      await expect(page.getByTestId("litt-mobile-tools-button"), "Tools button should be visible").toBeVisible();
      await page.getByTestId("litt-mobile-tools-button").click();
      await expect(page.getByTestId("mobile-tools-dialog"), "Tools sheet should open").toBeVisible();
      for (const tool of ["code", "canvas", "preview", "files", "terminal", "activity"]) {
        await expect(page.getByTestId(`mobile-tool-${tool}`), `tool row ${tool} should be visible`).toBeVisible();
      }
      await screenshot(page, testInfo, `density-tools-sheet-${width}px`);
      // Close the Tools sheet via its backdrop to return to chat.
      await page.getByTestId("mobile-tools-dialog").press("Escape");
      await expect(page.getByTestId("mobile-tools-dialog")).toBeHidden();

      await screenshot(page, testInfo, `density-chat-sheet-${width}px`);
    });
  }
});

// Visual evidence for the 2026-11-19 mobile layout card: long chat, a long
// answer collapsed behind Show more / Show less, an image rendered inline,
// a failed turn showing "We hit a snag, try again" + Retry, and the composer
// with a simulated keyboard — captured at 360px, 390px, and 768px into
// evidence/mobile/. The messages API is mocked so the states are
// deterministic and no real AI calls are made.
test.describe("LiTT Studio mobile visual evidence", () => {
  const LONG_ANSWER = [
    "Here is the full breakdown you asked for. ",
    "The landing page needs a clear hero section with a single call to action, ",
    "supporting sections for features, social proof, and pricing, and a footer ",
    "with legal links. Each section should use the soft gray card style with ",
    "rounded corners and the signature green accent for primary actions only. ",
    "Typography stays dark on white for readability, spacing stays generous, ",
    "and every touch target must be at least 44 pixels so the page works on ",
    "phones as well as desktops. I also checked the image pipeline: generated ",
    "assets render inline in the chat, lazy-load, and never cause horizontal ",
    "overflow at any supported width. Below is the mock hero image.",
    "",
    "![Generated hero mockup](/icon-512.png)",
    "",
    "If you want a different tone or section order, tell me and I will revise.",
  ].join("");

  async function mockMessageSequence(page: Page) {
    let call = 0;
    // The client polls GET .../messages while a run looks active; the mock
    // must therefore behave like a real backend and persist each turn, or
    // the polls would wipe the streamed messages from the transcript.
    const persisted: Array<Record<string, unknown>> = [];
    let revision = 1;
    const now = () => new Date().toISOString();
    const mkMsg = (
      id: string,
      role: "user" | "assistant",
      content: string,
      status: string,
    ): Record<string, unknown> => ({
      id,
      conversationId: "conv-mobile-evidence",
      ownerId: "user-evidence",
      projectId: "",
      role,
      agentSlug: role === "assistant" ? "litt" : null,
      agentMode: null,
      agentInstanceId: null,
      content,
      status,
      parentMessageId: null,
      regenerationOfMessageId: null,
      clientRequestId: null,
      createdAt: now(),
      updatedAt: now(),
    });
    // Give the workspace a projectId so handleComposerSend skips its
    // post-send refreshCapabilities() await — otherwise the composer's
    // synchronous submit lock stays held for the health-check round-trip
    // and a fast follow-up Enter is silently dropped.
    await page.route("**/api/capabilities**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          capabilities: [
            {
              id: "project",
              status: "ready",
              projectId: "proj-mobile-evidence",
              projectName: "Mobile evidence chat",
            },
          ],
        }),
      });
    });
    await page.route("**/api/studio/**", async (route) => {
      const { appendFileSync } = await import("fs");
      appendFileSync(
        "test-results/evidence-route.log",
        `${new Date().toISOString()} ${route.request().method()} ${route.request().url()}\n`,
      );
      const url = route.request().url();
      const method = route.request().method();
      if (method === "POST" && url.endsWith("/api/studio/conversations")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            conversation: {
              id: "conv-mobile-evidence",
              ownerId: "user-evidence",
              projectId: "",
              title: "Mobile evidence chat",
              activeAgentSlug: "litt",
              activeAgentMode: "auto",
              agentInstanceId: null,
              revision: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              archivedAt: null,
            },
          }),
        });
        return;
      }
      if (method === "GET" && /\/api\/studio\/conversations\/[^/]+\/messages$/.test(url)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ messages: persisted, revision }),
        });
        return;
      }
      const isMessagePost =
        method === "POST" && /\/api\/studio\/conversations\/[^/]+\/messages$/.test(url);
      if (!isMessagePost) {
        await route.continue();
        return;
      }
      call += 1;
      revision += 1;
      const request = route.request();
      const body = JSON.parse(request.postData() ?? "{}") as { message?: string };
      const userMessageId = `ev-user-${call}`;
      const assistantMessageId = `ev-assistant-${call}`;
      const userMsg = mkMsg(userMessageId, "user", body.message ?? "", "completed");

      if (call === 3) {
        // Third turn fails server-side: 200 JSON error body marks the
        // assistant message failed (raw text stays internal; UI shows the
        // safe "We hit a snag" copy + Retry).
        const failedContent = "provider exploded: internal stack trace that must never render";
        persisted.push(userMsg, mkMsg(assistantMessageId, "assistant", failedContent, "failed"));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            error: "provider exploded",
            detail: "internal stack trace that must never render",
            userMessage: userMsg,
            revision,
          }),
        });
        return;
      }

      const answer = call === 1 ? LONG_ANSWER : `Short follow-up answer number ${call}. All done.`;
      persisted.push(userMsg, mkMsg(assistantMessageId, "assistant", answer, "completed"));
      const mockResponse = [
        `data: ${JSON.stringify({
          type: "user_message",
          userMessage: userMsg,
          revision,
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "assistant_message",
          assistantMessage: { ...mkMsg(assistantMessageId, "assistant", "", "streaming") },
        })}\n\n`,
        `data: ${JSON.stringify({ type: "text", text: answer })}\n\n`,
        `data: ${JSON.stringify({
          type: "done",
          userMessage: userMsg,
          assistantMessage: mkMsg(assistantMessageId, "assistant", answer, "completed"),
          revision,
        })}\n\n`,
        `data: [DONE]\n\n`,
      ].join("");

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: mockResponse,
      });
    });
  }

  async function sendAndWait(page: Page, text: string, expectedText: string) {
    const input = page.getByTestId("studio-command-input");
    await input.fill(text);
    await expect(input).toHaveValue(text);
    // Enter submits — the send-button click proved flaky once a completion
    // card mounted between turns (click landed but React state was stale).
    await input.press("Enter");
    try {
      await expect(page.getByText(expectedText).last()).toBeVisible({ timeout: 30_000 });
    } catch (err) {
      const { writeFileSync } = await import("fs");
      const diag = await page.evaluate(() =>
        (window as unknown as { __mobileDiagDump?: () => string }).__mobileDiagDump?.() ?? "no-dump",
      );
      writeFileSync(`test-results/evidence-diag-${expectedText.slice(0, 20).replace(/\W+/g, "_")}.txt`, diag);
      throw err;
    }
  }

  async function shot(page: Page, name: string) {
    const directory = path.join("evidence", "mobile");
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${name}.png`), animations: "disabled", fullPage: false });
  }

  for (const width of [360, 390, 768]) {
    test(`evidence at ${width}px — long chat, collapsed answer, image, snag+retry, keyboard`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const { appendFileSync } = await import("fs");
      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") {
          appendFileSync("test-results/evidence-console.log", `${msg.type()}: ${msg.text()}\n`);
        }
      });
      page.on("pageerror", (err) => {
        appendFileSync("test-results/evidence-console.log", `pageerror: ${err.message}\n`);
      });
      await mockMessageSequence(page);

      const response = await page.goto("/studio", { waitUntil: "domcontentloaded", timeout: 90_000 });
      expect(response?.status()).toBe(200);
      await expect(page.locator(".studio-shell")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("litt-mobile-sheet")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("studio-loading")).not.toBeVisible();

      // Turn 1: long answer (>600 chars) with an inline image — collapsed.
      await sendAndWait(page, "Build me a landing page", "Show more");
      await expect(page.getByText("We hit a snag", { exact: false })).toHaveCount(0);
      await shot(page, `${width}-long-answer-collapsed`);

      // Expand, verify image + full text, collapse again.
      await page.getByRole("button", { name: "Show more" }).first().click();
      await expect(page.getByRole("button", { name: "Show less" }).first()).toBeVisible();
      // Scope to the mobile sheet — the desktop transcript stays mounted
      // (display:none) and its copy of the image never fetches. The image
      // must actually decode (naturalWidth > 0), not merely exist in the DOM.
      const heroImage = page
        .getByTestId("litt-mobile-sheet")
        .locator('img[alt="Generated hero mockup"]');
      await heroImage.scrollIntoViewIfNeeded();
      await expect(heroImage).toBeAttached();
      try {
        await expect
          .poll(
            () => heroImage.evaluate((el: HTMLImageElement) => el.naturalWidth),
            { timeout: 15_000 },
          )
          .toBeGreaterThan(0);
      } catch (err) {
        const { writeFileSync } = await import("fs");
        const diag = await heroImage.evaluate(async (el: HTMLImageElement) => {
          const chain: string[] = [];
          let node: HTMLElement | null = el;
          while (node && chain.length < 12) {
            const cs = getComputedStyle(node);
            chain.push(
              `${node.tagName.toLowerCase()}${node.getAttribute("data-testid") ? `[${node.getAttribute("data-testid")}]` : ""} disp=${cs.display} vis=${cs.visibility} op=${cs.opacity} h=${node.getBoundingClientRect().height}`,
            );
            node = node.parentElement;
          }
          const probe = new Image();
          probe.src = el.src;
          const fetchStatus = await fetch(el.src, { cache: "no-store" })
            .then((r) => `${r.status} ${r.headers.get("content-type")}`)
            .catch((e) => `fetch-error:${e instanceof Error ? e.message : e}`);
          return JSON.stringify(
            {
              src: el.currentSrc || el.src,
              loading: el.loading,
              decoding: el.decoding,
              fetchStatus,
              probeComplete: probe.complete,
              complete: el.complete,
              naturalWidth: el.naturalWidth,
              naturalHeight: el.naturalHeight,
              rect: el.getBoundingClientRect().toJSON(),
              chain,
              resources: performance
                .getEntriesByType("resource")
                .filter((r) => r.name.includes("icon-512"))
                .map((r) => `${r.name} ${r.initiatorType}`),
            },
            null,
            2,
          );
        });
        writeFileSync(`test-results/evidence-img-diag-${width}.json`, diag);
        throw err;
      }
      await shot(page, `${width}-long-answer-expanded`);
      await page.getByRole("button", { name: "Show less" }).first().click();

      // Turn 2: short answer so the transcript reads as a long chat.
      await sendAndWait(page, "Looks good, continue", "Short follow-up answer number 2");
      await shot(page, `${width}-long-chat`);

      // Turn 3: provider failure → safe copy + Retry, never raw error text.
      await sendAndWait(page, "Try once more", "We hit a snag, try again.");
      const failedTurn = page.locator('[data-testid="studio-transcript"]').last();
      await expect(failedTurn.getByText("We hit a snag, try again.")).toBeVisible();
      // The canonical retry control carries data-testid="retry-<messageId>";
      // scope to it — a second icon-only Retry button also lives in the
      // transcript and trips strict mode.
      await expect(failedTurn.locator('[data-testid^="retry-"]')).toBeVisible();
      await expect(page.getByText("provider exploded")).toHaveCount(0);
      await expect(page.getByText("internal stack trace")).toHaveCount(0);
      await failedTurn.scrollIntoViewIfNeeded();
      await shot(page, `${width}-snag-retry`);

      // Composer with a simulated Android keyboard (short viewport).
      const input = page.getByTestId("studio-command-input");
      await input.focus();
      await page.setViewportSize({ width, height: 500 });
      await expect(input).toBeFocused();
      await shot(page, `${width}-keyboard-open`);
      await page.setViewportSize({ width, height: 844 });

      // No sideways scrolling at any point.
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, "no horizontal overflow").toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
  }
});
