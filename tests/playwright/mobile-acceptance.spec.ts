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
  const nav = await visibleRect(page.locator('nav[aria-label="Studio navigation"]:visible'), "mobile bottom navigation");
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
  expect(viewport.documentScrollWidth, "page should have no horizontal overflow").toBeLessThanOrEqual(
    viewport.documentClientWidth + 1,
  );
  expect(bottom(sheet), "sheet should end above the mobile bottom navigation").toBeLessThanOrEqual(nav.y + 1);
  expect(nav.y, "mobile bottom navigation should not overlap the sheet").toBeGreaterThanOrEqual(bottom(sheet) - 1);

  return { viewport, sheet, composer, input, action, nav };
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
    await expect(page.getByTestId("studio-preview-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("litt-mobile-trigger")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("studio-loading")).not.toBeVisible();
    await screenshot(page, testInfo, "A-initial-authenticated-studio-390x844");

    const trigger = page.getByRole("button", { name: "Ask LiTT to build" });
    const triggerRect = await visibleRect(trigger, "Ask LiTT to build");
    const initialPosition = await page.evaluate(() => ({
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(initialPosition.scrollX, "trigger should be reachable without horizontal scrolling").toBe(0);
    expect(initialPosition.scrollY, "trigger should be reachable without vertical scrolling").toBe(0);
    expectWithinViewport(triggerRect, { x: 0, y: 0, width: initialPosition.width, height: initialPosition.height }, "Ask LiTT to build");
    expect(initialPosition.scrollWidth, "initial Studio should have no horizontal overflow").toBeLessThanOrEqual(
      initialPosition.clientWidth + 1,
    );
    await screenshot(page, testInfo, "B-ask-litt-visible-without-scrolling");

    await trigger.click();
    await expect(page.getByTestId("litt-mobile-sheet")).toBeVisible();
    await expect(page.getByTestId("litt-mobile-tab-chat")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("litt-mobile-chat-panel")).toHaveAttribute("data-active", "true");
    // Mobile density redesign: the composer context line moved into the slim
    // sheet header row; the old persistent context line is hidden on mobile.
    await expect(page.getByTestId("studio-workspace-context")).toBeHidden();
    if (await page.getByTestId("litt-mobile-context").count() > 0) {
      await expect(page.getByTestId("litt-mobile-context")).toBeVisible();
      await expect(page.getByTestId("litt-mobile-context")).not.toBeEmpty();
    }
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
    await page.getByTestId("litt-mobile-sheet-close").click();
    await expect(page.getByTestId("litt-mobile-sheet")).toBeHidden();

    // The developer drawer intentionally takes ownership of the mobile
    // surface while open, so the LiTT trigger is hidden until the user closes
    // it. Keep this explicit user sequence covered instead of weakening the
    // product's progressive-disclosure behavior.
    const collapsedDeveloperTools = page.getByTestId("dock-collapsed-toggle");
    if (await collapsedDeveloperTools.count() > 0 && await collapsedDeveloperTools.isVisible()) {
      await collapsedDeveloperTools.click();
      await expect(page.getByTestId("dock-close")).toBeVisible();
      await expect(page.getByTestId("litt-mobile-trigger")).toBeHidden();
      await page.getByTestId("dock-close").click();
      await expect(page.getByTestId("litt-mobile-trigger")).toBeVisible();
      await page.getByTestId("litt-mobile-trigger").click();
      await expect(page.getByTestId("litt-mobile-sheet")).toBeVisible();
      await page.getByTestId("litt-mobile-sheet-close").click();
      await expect(page.getByTestId("litt-mobile-sheet")).toBeHidden();
    }

    const mobileNav = page.locator('nav[aria-label="Studio navigation"]:visible');
    await expect(mobileNav).toBeVisible();
    const assetsButton = mobileNav.getByRole("button", { name: "Assets" });
    await assetsButton.click();
    await expect(assetsButton).toHaveAttribute("aria-current", "page");
    await screenshot(page, testInfo, "F-sheet-closed-bottom-nav-usable");
  });
});

test.describe("LiTT Studio mobile density redesign", () => {
  for (const width of [390, 670]) {
    test(`density geometry at ${width}px — chat dominates, cards collapsed`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });

      const response = await page.goto("/studio", { waitUntil: "domcontentloaded", timeout: 90_000 });
      expect(response?.status(), "authenticated Studio navigation should return 200").toBe(200);
      await expect(page).toHaveURL(/\/studio(?:[/?#]|$)/);
      await expect(page.locator(".studio-shell")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("litt-mobile-trigger")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("studio-loading")).not.toBeVisible();

      await page.getByRole("button", { name: "Ask LiTT to build" }).click();
      await expect(page.getByTestId("litt-mobile-sheet")).toBeVisible();
      await page.getByTestId("litt-mobile-tab-chat").click();
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

      // 3. Conversation + composer are the dominant surfaces.
      const transcript = page.getByTestId("studio-transcript");
      await expect(transcript, "transcript should be visible").toBeVisible();
      const transcriptRect = await visibleRect(transcript, "transcript");
      const viewportHeight = 844;
      expect(
        transcriptRect.height,
        "transcript should occupy the majority of the first viewport",
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
