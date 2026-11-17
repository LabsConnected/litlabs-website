import { beforeEach, describe, expect, it } from "vitest";
import {
  BOARD_LAYOUT_STORAGE_KEY,
  migrateBoardLayoutPersistedState,
  useBoardLayoutStore,
  type BoardLayoutPersistedState,
} from "./useBoardLayoutStore";
import { defaultBoardLayout, seedPanelRect } from "../components/board/board-layout";
import {
  BOARD_CHAT_UNTOUCHED_DEFAULT_RECT,
  BOARD_DESIGN_AREA,
  boardDefinition,
  boardScopeKey,
} from "../components/board/board-types";

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

  it("maximize fills the region and restore returns the exact prior rect", () => {
    const rect = { ...layout().panels.code.rect };
    const region = { x: 0, y: 0, width: 1400, height: 900 };
    store.getState().toggleMaximize(SCOPE, "code", region);
    expect(layout().panels.code.maximized).toBe(true);
    expect(layout().panels.code.rect).toEqual({ x: 0, y: 0, width: 1400, height: 900 });
    store.getState().toggleMaximize(SCOPE, "code", region);
    expect(layout().panels.code.maximized).toBe(false);
    expect(layout().panels.code.rect).toEqual(rect);
  });

  it("maximize fills a region with a non-zero origin exactly (pan/zoom safe)", () => {
    const region = { x: 120, y: 80, width: 1100, height: 700 };
    store.getState().toggleMaximize(SCOPE, "code", region);
    expect(layout().panels.code.maximized).toBe(true);
    expect(layout().panels.code.rect).toEqual(region);
  });

  it("summoning a closed panel resets it to its full default size, keeping position", () => {
    const def = boardDefinition("code");
    store.getState().setPanelRect(SCOPE, "code", { x: 50, y: 60, width: 300, height: 200 });
    store.getState().closePanel(SCOPE, "code");
    store.getState().openPanel(SCOPE, "code");
    const panel = layout().panels.code;
    expect(panel.open).toBe(true);
    expect(panel.rect.width).toBe(def.defaultRect.width);
    expect(panel.rect.height).toBe(def.defaultRect.height);
    expect(panel.rect.x).toBe(50);
    expect(panel.rect.y).toBe(60);
  });

  it("re-summoning an already-open panel keeps the user's size", () => {
    store.getState().openPanel(SCOPE, "files");
    store.getState().setPanelRect(SCOPE, "files", { x: 70, y: 80, width: 320, height: 240 });
    store.getState().openPanel(SCOPE, "files");
    expect(layout().panels.files.rect).toEqual({ x: 70, y: 80, width: 320, height: 240 });
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
    store.getState().toggleMaximize(SCOPE, "code", { x: 0, y: 0, width: 1400, height: 900 });
    store.getState().setPanelRect(SCOPE, "code", { x: 5, y: 5, width: 10, height: 10 });
    expect(layout().panels.code.maximized).toBe(false);
    expect(layout().panels.code.rect.width).toBe(240);
    // Board-only rebuild: the minimum panel height dropped to 120 so
    // panels resize freely from the bottom edge (checklist item 6).
    expect(layout().panels.code.rect.height).toBe(120);
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

describe("persist migration → v3 (board-only rebuild defaults)", () => {
  /** A pre-v3 save: old-default panels, a user-moved Files rect, a
   *  deliberate Terminal close, and a saved preset. The board-only
   *  rebuild changed the panel inventory and the default arrangement
   *  (Larry's Command Center mockup v2), so migration re-seeds every
   *  scope's panels from the NEW defaults exactly once — presets, the
   *  active preset name, viewports and the per-user toggle carry over. */
  function oldState(): BoardLayoutPersistedState {
    const website = defaultBoardLayout("website");
    website.panels.files.rect = { x: 300, y: 260, width: 420, height: 300 };
    website.panels.terminal.open = false;
    website.presets.Keep = { name: "Keep", savedAt: 1, panels: structuredClone(website.panels) };
    const game = defaultBoardLayout("game");
    game.panels.media.open = false;
    return {
      enabledByUser: { [USER]: true },
      scopes: { [SCOPE]: website, "user_1::game_1": game },
    };
  }

  it("re-seeds every scope's panels from the new mockup defaults", () => {
    const migrated = migrateBoardLayoutPersistedState(oldState(), 1);
    const website = migrated.scopes[SCOPE];
    // The v2 mockup arrangement: chat, preview, files, media (the
    // Terminal joins them only when the user asks — Finish Spec).
    for (const id of ["chat", "preview", "files", "media"] as const) {
      expect(website.panels[id].open).toBe(true);
    }
    for (const id of ["code", "health", "deploy", "browser"] as const) {
      expect(website.panels[id].open).toBe(false);
    }
    // Old geometry is gone — panels carry the new default rects.
    expect(website.panels.files.rect).toEqual(defaultBoardLayout("website").panels.files.rect);
    // The re-seed lands on the current defaults: Terminal closed until
    // requested (Studio Finish Spec, 2026-11-14).
    expect(website.panels.terminal.open).toBe(false);
    // Game scopes re-seed from the game defaults too (media back open).
    expect(migrated.scopes["user_1::game_1"].panels.media.open).toBe(true);
    expect(migrated.scopes["user_1::game_1"].panels.world.open).toBe(true);
    expect(migrated.enabledByUser[USER]).toBe(true);
  });

  it("preserves presets untouched (applyPreset backfills missing panels)", () => {
    const migrated = migrateBoardLayoutPersistedState(oldState(), 2);
    const website = migrated.scopes[SCOPE];
    expect(website.presets.Keep).toBeDefined();
    expect(website.presets.Keep.panels.files.rect).toEqual({ x: 300, y: 260, width: 420, height: 300 });
  });

  it("leaves v5 state and unrecognized input untouched", () => {
    const v5 = oldState();
    expect(migrateBoardLayoutPersistedState(v5, 5)).toBe(v5);
    expect(migrateBoardLayoutPersistedState(null, 1)).toBeNull();
    expect(migrateBoardLayoutPersistedState("junk", 1)).toBe("junk");
  });

  it("v3 → v4 closes an untouched default Terminal but keeps a user-arranged one", () => {
    const state = oldState();
    // oldState's website scope closed its terminal deliberately; open
    // it at the exact default rect to model the old default layout.
    state.scopes[SCOPE].panels.terminal.open = true;
    const migrated = migrateBoardLayoutPersistedState(state, 3);
    expect(migrated.scopes[SCOPE].panels.terminal.open).toBe(false);
    // Other panels are not touched by the v4 step.
    expect(migrated.scopes[SCOPE].panels.files.open).toBe(true);

    const arranged = oldState();
    arranged.scopes[SCOPE].panels.terminal.open = true;
    arranged.scopes[SCOPE].panels.terminal.rect = { x: 40, y: 40, width: 500, height: 200 };
    const kept = migrateBoardLayoutPersistedState(arranged, 3);
    expect(kept.scopes[SCOPE].panels.terminal.open).toBe(true);
  });
});

describe("persist migration → v5 (centered chat + retired panels)", () => {
  /** A v4 save: chat still at its old untouched default rect unless a
   *  test moves it, plus — in one test — entries for the retired
   *  inspector / plan / canvas panels injected past the type system,
   *  the way a real pre-v5 localStorage save would carry them. */
  function v4State(): BoardLayoutPersistedState {
    return {
      enabledByUser: { [USER]: true },
      scopes: { [SCOPE]: defaultBoardLayout("website") },
    };
  }

  it("moves a chat still at the exact untouched default to the centered-top seed", () => {
    const state = v4State();
    expect(state.scopes[SCOPE].panels.chat.rect).toEqual(BOARD_CHAT_UNTOUCHED_DEFAULT_RECT);
    const migrated = migrateBoardLayoutPersistedState(state, 4);
    expect(migrated.scopes[SCOPE].panels.chat.rect).toEqual(
      seedPanelRect("chat", BOARD_DESIGN_AREA),
    );
    // Nothing else moved: a neighbour keeps its exact rect and state.
    expect(migrated.scopes[SCOPE].panels.files).toBe(state.scopes[SCOPE].panels.files);
    expect(migrated.enabledByUser[USER]).toBe(true);
  });

  it("keeps a user-moved chat exactly where the user put it", () => {
    const state = v4State();
    const moved = { x: 900, y: 300, width: 500, height: 400 };
    state.scopes[SCOPE].panels.chat.rect = { ...moved };
    const migrated = migrateBoardLayoutPersistedState(state, 4);
    expect(migrated.scopes[SCOPE].panels.chat.rect).toEqual(moved);
    // No change was needed anywhere, so the scope passes through as-is.
    expect(migrated.scopes[SCOPE]).toBe(state.scopes[SCOPE]);
  });

  it("drops retired panel entries (inspector / plan / canvas) without crashing", () => {
    const state = v4State();
    const panels = state.scopes[SCOPE].panels as unknown as Record<string, unknown>;
    const ghost = {
      id: "inspector",
      rect: { x: 10, y: 10, width: 300, height: 300 },
      z: 99,
      open: true,
      minimized: false,
      maximized: false,
      restoreRect: null,
    };
    panels.inspector = ghost;
    panels.plan = { ...ghost, id: "plan" };
    panels.canvas = { ...ghost, id: "canvas" };
    const migrated = migrateBoardLayoutPersistedState(state, 4);
    const migratedPanels = migrated.scopes[SCOPE].panels as unknown as Record<string, unknown>;
    expect(migratedPanels.inspector).toBeUndefined();
    expect(migratedPanels.plan).toBeUndefined();
    expect(migratedPanels.canvas).toBeUndefined();
    expect(migrated.scopes[SCOPE].panels.chat).toBeDefined();
    expect(migrated.scopes[SCOPE].panels.world).toBeDefined();
  });
});
