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
    await expect(page.getByTestId("studio-workspace-context")).toBeVisible();
    await expect(page.getByTestId("studio-workspace-context")).not.toBeEmpty();
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
    const mobileNav = page.locator('nav[aria-label="Studio navigation"]:visible');
    await expect(mobileNav).toBeVisible();
    const assetsButton = mobileNav.getByRole("button", { name: "Assets" });
    await assetsButton.click();
    await expect(assetsButton).toHaveAttribute("aria-current", "page");
    await screenshot(page, testInfo, "F-sheet-closed-bottom-nav-usable");
  });
});
