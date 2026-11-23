import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_LAYOUT_STORAGE_KEY } from "./useBoardLayoutStore";
import { boardScopeKey } from "../components/board/board-types";

/**
 * Regression (live defect, Larry 2026-11-22): a maximized panel that
 * the user restored came back maximized after a page reload.
 *
 * Each dynamic import below stands in for one browser window: a fresh
 * module instance whose store rehydrates from the shared localStorage
 * exactly like a real window's page load. zustand/persist writes the
 * whole layout record on every change but (before the fix) never
 * listened for other windows' writes, so a stale window — one still
 * holding the maximized snapshot — silently overwrote a restore made
 * in another window the next time it wrote anything at all (the
 * board's own mount effects write the viewport unprompted). The
 * restore only LOOKED lost on reload; it had been clobbered in
 * storage minutes earlier.
 */
const USER = "user_1";
const PROJECT = "project_1";
const SCOPE = boardScopeKey(USER, PROJECT);
const REGION = { x: 0, y: 0, width: 1400, height: 900 };

async function freshWindow() {
  vi.resetModules();
  const mod = await import("./useBoardLayoutStore");
  return mod.useBoardLayoutStore;
}

function persistedPanel(id: "preview" | "browser") {
  const raw = localStorage.getItem(BOARD_LAYOUT_STORAGE_KEY);
  expect(raw).toBeTruthy();
  return JSON.parse(raw!).state.scopes[SCOPE].panels[id];
}

/** What a real browser does on its own: when one window writes
 *  localStorage, every OTHER window receives a storage event.
 *  jsdom does not deliver it between module instances, so the test
 *  delivers it by hand. */
function deliverStorageEventToOtherWindows() {
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: BOARD_LAYOUT_STORAGE_KEY,
      newValue: localStorage.getItem(BOARD_LAYOUT_STORAGE_KEY),
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("board layout cross-window persistence", () => {
  it("a restore in one window survives a stale window's later write and a reload", async () => {
    // Window A: the board as it was — Static View and Browser maximized.
    const a = await freshWindow();
    a.getState().ensureScope(USER, PROJECT, "website");
    const previewRect = { ...a.getState().scopes[SCOPE].panels.preview.rect };
    const browserRect = { ...a.getState().scopes[SCOPE].panels.browser.rect };
    a.getState().toggleMaximize(SCOPE, "preview", REGION);
    a.getState().toggleMaximize(SCOPE, "browser", REGION);
    expect(persistedPanel("preview").maximized).toBe(true);
    expect(persistedPanel("browser").maximized).toBe(true);

    // Window B: the user restores both panels. The restores persist.
    const b = await freshWindow();
    expect(b.getState().scopes[SCOPE].panels.preview.maximized).toBe(true);
    b.getState().toggleMaximize(SCOPE, "preview", REGION);
    b.getState().toggleMaximize(SCOPE, "browser", REGION);
    expect(persistedPanel("preview").maximized).toBe(false);
    expect(persistedPanel("browser").maximized).toBe(false);
    deliverStorageEventToOtherWindows();

    // Window A is still open, still holding its pre-restore snapshot.
    // Its next write is unrelated to the panels — a viewport pan, the
    // same kind of write the board's mount effects make on their own.
    // With cross-window sync A has already re-read B's save, so the
    // write carries the restored panels, not the stale maximized ones.
    a.getState().setViewport(SCOPE, { panX: 12, panY: 0, scale: 0.93 });
    expect(persistedPanel("preview").maximized).toBe(false);
    expect(persistedPanel("browser").maximized).toBe(false);

    // A plain page reload re-reads storage: both panels stay restored,
    // at their exact pre-maximize rects — and window A's pan landed.
    const reloaded = await freshWindow();
    const layout = reloaded.getState().scopes[SCOPE];
    expect(layout.panels.preview.maximized).toBe(false);
    expect(layout.panels.browser.maximized).toBe(false);
    expect(layout.panels.preview.rect).toEqual(previewRect);
    expect(layout.panels.browser.rect).toEqual(browserRect);
    expect(layout.viewport.panX).toBe(12);
  });
});
