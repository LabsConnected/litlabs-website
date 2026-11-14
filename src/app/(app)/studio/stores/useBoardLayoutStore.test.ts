import { beforeEach, describe, expect, it } from "vitest";
import {
  BOARD_LAYOUT_STORAGE_KEY,
  useBoardLayoutStore,
} from "./useBoardLayoutStore";
import { boardScopeKey } from "../components/board/board-types";

const USER = "user_1";
const PROJECT = "project_1";
const SCOPE = boardScopeKey(USER, PROJECT);
const store = useBoardLayoutStore;

function layout() {
  return store.getState().scopes[SCOPE];
}

beforeEach(() => {
  localStorage.clear();
  store.setState({ enabledByUser: {}, scopes: {} });
  store.getState().ensureScope(USER, PROJECT, "website");
});

describe("board toggle", () => {
  it("defaults OFF and flips per user only", () => {
    expect(store.getState().enabledByUser[USER]).toBeUndefined();
    store.getState().setBoardEnabled(USER, true);
    expect(store.getState().enabledByUser[USER]).toBe(true);
    expect(store.getState().enabledByUser["user_2"]).toBeUndefined();
    store.getState().setBoardEnabled(USER, false);
    expect(store.getState().enabledByUser[USER]).toBe(false);
  });
});

describe("scope isolation", () => {
  it("keeps layouts separate per user + project", () => {
    store.getState().ensureScope(USER, "project_2", "game");
    store.getState().openPanel(SCOPE, "files");
    const other = store.getState().scopes[boardScopeKey(USER, "project_2")];
    expect(other.panels.files.open).toBe(false);
    expect(other.projectType).toBe("game");
    expect(layout().panels.files.open).toBe(true);
  });

  it("ignores actions for a scope that was never ensured", () => {
    const before = store.getState().scopes;
    store.getState().openPanel("nobody::nowhere", "files");
    expect(store.getState().scopes).toBe(before);
  });
});

describe("panel window actions", () => {
  it("open brings the panel to the front; close hides it", () => {
    const zBefore = layout().panels.files.z;
    store.getState().openPanel(SCOPE, "files");
    expect(layout().panels.files.open).toBe(true);
    expect(layout().panels.files.z).toBeGreaterThan(zBefore);
    store.getState().closePanel(SCOPE, "files");
    expect(layout().panels.files.open).toBe(false);
  });

  it("minimize keeps the rect and restore returns it exactly, on top", () => {
    const rect = { ...layout().panels.preview.rect };
    store.getState().minimizePanel(SCOPE, "preview");
    expect(layout().panels.preview.minimized).toBe(true);
    expect(layout().panels.preview.rect).toEqual(rect);
    store.getState().restorePanel(SCOPE, "preview");
    expect(layout().panels.preview.minimized).toBe(false);
    expect(layout().panels.preview.rect).toEqual(rect);
  });

  it("maximize fills the area and restore returns the exact prior rect", () => {
    const rect = { ...layout().panels.code.rect };
    store.getState().toggleMaximize(SCOPE, "code", { width: 1400, height: 900 });
    expect(layout().panels.code.maximized).toBe(true);
    expect(layout().panels.code.rect).toEqual({ x: 0, y: 0, width: 1400, height: 900 });
    store.getState().toggleMaximize(SCOPE, "code", { width: 1400, height: 900 });
    expect(layout().panels.code.maximized).toBe(false);
    expect(layout().panels.code.rect).toEqual(rect);
  });

  it("bringToFront raises z above every other panel exactly once", () => {
    store.getState().bringToFront(SCOPE, "files");
    const z = layout().panels.files.z;
    const maxOther = Math.max(
      ...Object.values(layout().panels)
        .filter((p) => p.id !== "files")
        .map((p) => p.z),
    );
    expect(z).toBeGreaterThan(maxOther);
    store.getState().bringToFront(SCOPE, "files");
    expect(layout().panels.files.z).toBe(z);
  });

  it("setPanelRect clamps to the minimum size and clears maximized", () => {
    store.getState().toggleMaximize(SCOPE, "code", { width: 1400, height: 900 });
    store.getState().setPanelRect(SCOPE, "code", { x: 5, y: 5, width: 10, height: 10 });
    expect(layout().panels.code.maximized).toBe(false);
    expect(layout().panels.code.rect.width).toBe(240);
    expect(layout().panels.code.rect.height).toBe(160);
  });
});

describe("tidy + overview actions", () => {
  it("tidy snaps the open panels into the area grid", () => {
    store.getState().tidy(SCOPE, { width: 1200, height: 800 });
    for (const panel of Object.values(layout().panels)) {
      if (!panel.open) continue;
      expect(panel.rect.x + panel.rect.width).toBeLessThanOrEqual(1200);
      expect(panel.rect.y + panel.rect.height).toBeLessThanOrEqual(800);
    }
  });

  it("overview zooms out and toggling again restores the exact viewport", () => {
    store.getState().setViewport(SCOPE, { panX: 40, panY: 24, scale: 1 });
    store.getState().toggleOverview(SCOPE, { width: 800, height: 600 });
    expect(layout().viewport.scale).toBeLessThan(1);
    store.getState().toggleOverview(SCOPE, { width: 800, height: 600 });
    expect(layout().viewport).toEqual({ panX: 40, panY: 24, scale: 1 });
    expect(layout().overviewReturnViewport).toBeNull();
  });
});

describe("presets", () => {
  it("saves, applies and deletes named presets without touching others", () => {
    store.getState().setPanelRect(SCOPE, "preview", { x: 100, y: 90, width: 500, height: 400 });
    store.getState().savePreset(SCOPE, "Design");
    store.getState().savePreset(SCOPE, "Code");
    expect(Object.keys(layout().presets).sort()).toEqual(["Code", "Design"]);

    store.getState().setPanelRect(SCOPE, "preview", { x: 0, y: 0, width: 300, height: 200 });
    store.getState().applyPreset(SCOPE, "Design");
    expect(layout().panels.preview.rect).toEqual({ x: 100, y: 90, width: 500, height: 400 });
    expect(layout().activePresetName).toBe("Design");

    store.getState().deletePreset(SCOPE, "Design");
    expect(layout().presets.Design).toBeUndefined();
    expect(layout().presets.Code).toBeDefined();
    expect(layout().activePresetName).toBeNull();
  });

  it("a saved preset is a snapshot — later moves do not leak into it", () => {
    store.getState().savePreset(SCOPE, "Design");
    store.getState().setPanelRect(SCOPE, "preview", { x: 999, y: 900, width: 500, height: 400 });
    expect(layout().presets.Design.panels.preview.rect.x).not.toBe(999);
  });

  it("reset restores defaults but keeps saved presets", () => {
    store.getState().savePreset(SCOPE, "Design");
    store.getState().closePanel(SCOPE, "preview");
    store.getState().resetLayout(SCOPE);
    expect(layout().panels.preview.open).toBe(true);
    expect(layout().presets.Design).toBeDefined();
  });
});

describe("persistence", () => {
  it("writes the toggle and layouts to localStorage under the board key", () => {
    store.getState().setBoardEnabled(USER, true);
    store.getState().openPanel(SCOPE, "media");
    const raw = localStorage.getItem(BOARD_LAYOUT_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.enabledByUser[USER]).toBe(true);
    expect(parsed.state.scopes[SCOPE].panels.media.open).toBe(true);
  });
});
