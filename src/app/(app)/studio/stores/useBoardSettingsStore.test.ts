import { beforeEach, describe, expect, it } from "vitest";
import {
  BOARD_SETTINGS_STORAGE_KEY,
  BOARD_TOOLBAR_PANEL_IDS,
  BOARD_ZOOM_LEVELS,
  DEFAULT_BOARD_SETTINGS,
  getBoardOpenBehavior,
  getBoardSettings,
  useBoardSettingsStore,
} from "./useBoardSettingsStore";

const store = useBoardSettingsStore;

beforeEach(() => {
  localStorage.clear();
  store.getState().resetBoardSettings();
});

describe("useBoardSettingsStore defaults (Amendment 5 — Larry's decided ones)", () => {
  it("opens panels full size, maximizes snap full, double-click header on", () => {
    const s = store.getState();
    expect(s.openSize).toBe("full");
    expect(s.maximizeSnapFull).toBe(true);
    expect(s.maximizeDoubleClickHeader).toBe(true);
  });

  it("new panels open where you are; layout restores per project", () => {
    const s = store.getState();
    expect(s.newPanelPlacement).toBe("where-you-are");
    expect(s.layoutMemory).toBe("per-project");
  });

  it("default zoom is 100% with Ctrl+scroll zoom on", () => {
    const s = store.getState();
    expect(s.defaultZoomPercent).toBe(100);
    expect(s.ctrlScrollZoom).toBe(true);
  });

  it("the toolbar shows exactly the nine panels, all on — Inspector is not one of them", () => {
    expect(BOARD_TOOLBAR_PANEL_IDS).toEqual([
      "chat",
      "preview",
      "code",
      "terminal",
      "files",
      "health",
      "deploy",
      "media",
      "browser",
    ]);
    const s = store.getState();
    for (const id of BOARD_TOOLBAR_PANEL_IDS) {
      expect(s.toolbarPanels[id]).toBe(true);
    }
  });

  it("DEFAULT_BOARD_SETTINGS matches the store's initial state", () => {
    expect(getBoardSettings()).toEqual(DEFAULT_BOARD_SETTINGS);
  });
});

describe("useBoardSettingsStore setters", () => {
  it("sets each open-behavior option", () => {
    store.getState().setOpenSize("remember");
    expect(store.getState().openSize).toBe("remember");
    store.getState().setOpenSize("smart");
    expect(store.getState().openSize).toBe("smart");
    store.getState().setNewPanelPlacement("center");
    expect(store.getState().newPanelPlacement).toBe("center");
    store.getState().setNewPanelPlacement("tile");
    expect(store.getState().newPanelPlacement).toBe("tile");
    store.getState().setLayoutMemory("fresh");
    expect(store.getState().layoutMemory).toBe("fresh");
  });

  it("toggles the maximize and Ctrl+scroll switches", () => {
    store.getState().setMaximizeSnapFull(false);
    store.getState().setMaximizeDoubleClickHeader(false);
    store.getState().setCtrlScrollZoom(false);
    const s = store.getState();
    expect(s.maximizeSnapFull).toBe(false);
    expect(s.maximizeDoubleClickHeader).toBe(false);
    expect(s.ctrlScrollZoom).toBe(false);
  });

  it("accepts only the discrete zoom levels and coerces anything else to 100", () => {
    for (const level of BOARD_ZOOM_LEVELS) {
      store.getState().setDefaultZoomPercent(level);
      expect(store.getState().defaultZoomPercent).toBe(level);
    }
    store.getState().setDefaultZoomPercent(137);
    expect(store.getState().defaultZoomPercent).toBe(100);
  });

  it("shows and hides individual toolbar panels without touching the others", () => {
    store.getState().setToolbarPanelVisible("media", false);
    expect(store.getState().toolbarPanels.media).toBe(false);
    expect(store.getState().toolbarPanels.chat).toBe(true);
    store.getState().setToolbarPanelVisible("media", true);
    expect(store.getState().toolbarPanels.media).toBe(true);
  });

  it("reset returns every setting to the defaults", () => {
    store.getState().setOpenSize("smart");
    store.getState().setCtrlScrollZoom(false);
    store.getState().setToolbarPanelVisible("code", false);
    store.getState().resetBoardSettings();
    expect(getBoardSettings()).toEqual(DEFAULT_BOARD_SETTINGS);
  });
});

describe("useBoardSettingsStore persistence", () => {
  it("writes the settings to localStorage under the board settings key", () => {
    store.getState().setOpenSize("remember");
    store.getState().setDefaultZoomPercent(125);
    const raw = localStorage.getItem(BOARD_SETTINGS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.openSize).toBe("remember");
    expect(parsed.state.defaultZoomPercent).toBe(125);
    expect(parsed.state.toolbarPanels.chat).toBe(true);
  });

  it("rehydrates saved settings from localStorage", async () => {
    localStorage.setItem(
      BOARD_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        state: {
          openSize: "smart",
          newPanelPlacement: "center",
          layoutMemory: "fresh",
          defaultZoomPercent: 75,
          ctrlScrollZoom: false,
          toolbarPanels: { browser: false },
        },
        version: 1,
      }),
    );
    await store.persist.rehydrate();
    const s = store.getState();
    expect(s.openSize).toBe("smart");
    expect(s.newPanelPlacement).toBe("center");
    expect(s.layoutMemory).toBe("fresh");
    expect(s.defaultZoomPercent).toBe(75);
    expect(s.ctrlScrollZoom).toBe(false);
    // A partial toolbar record keeps the other panels at their defaults.
    expect(s.toolbarPanels.browser).toBe(false);
    expect(s.toolbarPanels.chat).toBe(true);
  });

  it("coerces corrupted persisted values back to valid settings", async () => {
    localStorage.setItem(
      BOARD_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        state: { openSize: "enormous", defaultZoomPercent: 999, ctrlScrollZoom: "yes" },
        version: 1,
      }),
    );
    await store.persist.rehydrate();
    const s = store.getState();
    expect(s.openSize).toBe("full");
    expect(s.defaultZoomPercent).toBe(100);
    expect(s.ctrlScrollZoom).toBe(true);
  });
});

describe("layoutMode — the crossbreed switch choice (Amendment 8)", () => {
  it("defaults to null: never chosen, so the board default / legacy key decides", () => {
    expect(store.getState().layoutMode).toBeNull();
    expect(DEFAULT_BOARD_SETTINGS.layoutMode).toBeNull();
    expect(getBoardSettings().layoutMode).toBeNull();
  });

  it("setLayoutMode records an explicit board or classic choice", () => {
    store.getState().setLayoutMode("classic");
    expect(store.getState().layoutMode).toBe("classic");
    store.getState().setLayoutMode("board");
    expect(store.getState().layoutMode).toBe("board");
  });

  it("persists the choice under the board settings key", () => {
    store.getState().setLayoutMode("classic");
    const parsed = JSON.parse(localStorage.getItem(BOARD_SETTINGS_STORAGE_KEY) as string);
    expect(parsed.state.layoutMode).toBe("classic");
  });

  it("rehydrates a saved choice", async () => {
    localStorage.setItem(
      BOARD_SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { layoutMode: "classic" }, version: 1 }),
    );
    await store.persist.rehydrate();
    expect(store.getState().layoutMode).toBe("classic");
  });

  it("a legacy payload without layoutMode rehydrates to never-chosen (null)", async () => {
    localStorage.setItem(
      BOARD_SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { openSize: "smart" }, version: 1 }),
    );
    await store.persist.rehydrate();
    expect(store.getState().layoutMode).toBeNull();
  });

  it("coerces a corrupted persisted layoutMode back to never-chosen", async () => {
    localStorage.setItem(
      BOARD_SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { layoutMode: "sideways" }, version: 1 }),
    );
    await store.persist.rehydrate();
    expect(store.getState().layoutMode).toBeNull();
  });

  it("reset returns the choice to never-chosen", () => {
    store.getState().setLayoutMode("classic");
    store.getState().resetBoardSettings();
    expect(store.getState().layoutMode).toBeNull();
  });
});

describe("getBoardOpenBehavior (plain getter for the layout store)", () => {
  it("returns the open-behavior slice, live from the store", () => {
    expect(getBoardOpenBehavior()).toEqual({
      openSize: "full",
      newPanelPlacement: "where-you-are",
      layoutMemory: "per-project",
      maximizeSnapFull: true,
      maximizeDoubleClickHeader: true,
    });
    store.getState().setOpenSize("remember");
    store.getState().setNewPanelPlacement("center");
    expect(getBoardOpenBehavior().openSize).toBe("remember");
    expect(getBoardOpenBehavior().newPanelPlacement).toBe("center");
  });
});
