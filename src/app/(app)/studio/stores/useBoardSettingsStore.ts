"use client";

/**
 * Board settings store (spec Amendment 5, Larry 2026-11-16).
 *
 * Larry asked for a Board Settings menu — one place inside Studio
 * where he controls how the board behaves: how big panels open, what
 * maximize does, where new panels land, whether his layout comes back
 * per project, the default zoom, Ctrl+scroll zoom, and which panels
 * the pill toolbar shows. His picks were pending when the spec was
 * written; the defaults below are the decided ones (panels open full
 * size per spec §4b, new panels open where he is per his standing
 * panel-placement rule, layout restores per project per his standing
 * saved-layout rule).
 *
 * Persisted to localStorage like the board layout store, so the
 * choices survive reload. Read hook-free via
 * `useBoardSettingsStore.getState()` / `getBoardOpenBehavior()` from
 * code that has no React context (the layout store consumes the
 * open-behavior settings at integration time).
 *
 * Amendment 8 (Larry, 2026-11-17) added one more field to this store:
 * the crossbreed layout choice (`layoutMode`) — the natural home for
 * a persisted Studio preference. Its effective resolution (explicit
 * choice → legacy escape-hatch key → board) lives in
 * useStudioLayoutMode.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BoardPanelId } from "../components/board/board-types";

export const BOARD_SETTINGS_STORAGE_KEY = "litt-studio-board-settings-v1";

/** The nine panels the pill toolbar can show (spec: Inspector is
 *  retired as a toolbar entry — Jobs lives in the chat panel). */
export const BOARD_TOOLBAR_PANEL_IDS: BoardPanelId[] = [
  "chat",
  "preview",
  "code",
  "terminal",
  "files",
  "health",
  "deploy",
  "media",
  "browser",
];

/** How a panel opens (Amendment 5: "whether it opens big or whatever's
 *  the smartest"). Default: full size (spec §4b — panels open at the
 *  full size they are supposed to be). */
export type BoardOpenSizeMode = "full" | "remember" | "smart";
export const BOARD_OPEN_SIZE_OPTIONS: { value: BoardOpenSizeMode; label: string }[] = [
  { value: "full", label: "Full size" },
  { value: "remember", label: "Remember last" },
  { value: "smart", label: "Smart per panel type" },
];

/** Where a newly summoned panel lands. Default: open where you are
 *  (Larry's standing panel-placement rule). */
export type BoardNewPanelPlacement = "where-you-are" | "center" | "tile";
export const BOARD_NEW_PANEL_PLACEMENT_OPTIONS: {
  value: BoardNewPanelPlacement;
  label: string;
}[] = [
  { value: "where-you-are", label: "Where I am" },
  { value: "center", label: "Center" },
  { value: "tile", label: "Tile" },
];

/** Whether the board arrangement comes back per project or starts
 *  from the default arrangement. Default: restore per project. */
export type BoardLayoutMemory = "per-project" | "fresh";
export const BOARD_LAYOUT_MEMORY_OPTIONS: { value: BoardLayoutMemory; label: string }[] = [
  { value: "per-project", label: "Restore per project" },
  { value: "fresh", label: "Fresh default" },
];

/** Discrete default zoom levels offered in the settings menu. */
export const BOARD_ZOOM_LEVELS = [50, 75, 100, 125, 150] as const;
export type BoardZoomLevel = (typeof BOARD_ZOOM_LEVELS)[number];

/**
 * The Studio layout the user picked (spec Amendment 8 — the
 * "crossbreed" switch, Larry 2026-11-17): the board stays the flagship
 * default, and the regular (classic) layout stays one flip away for
 * anyone who prefers it. `null` means the user has never used the
 * switch — the effective mode then falls back to the pre-switch
 * escape-hatch key (`litt:studio:layout-mode`) and finally to "board".
 * The resolution lives in useStudioLayoutMode; this field is only the
 * persisted explicit choice.
 */
export type StudioLayoutMode = "board" | "classic";
export const STUDIO_LAYOUT_MODE_OPTIONS: { value: StudioLayoutMode; label: string }[] = [
  { value: "board", label: "Board" },
  { value: "classic", label: "Regular" },
];

export interface BoardSettings {
  /** Explicit layout choice from the crossbreed switch (Amendment 8);
   *  null = never chosen (see StudioLayoutMode). */
  layoutMode: StudioLayoutMode | null;
  openSize: BoardOpenSizeMode;
  /** Maximize snaps the panel to fill the whole visible board. */
  maximizeSnapFull: boolean;
  /** Double-clicking a panel header toggles maximize. */
  maximizeDoubleClickHeader: boolean;
  newPanelPlacement: BoardNewPanelPlacement;
  layoutMemory: BoardLayoutMemory;
  /** Zoom the board starts at, in percent (one of BOARD_ZOOM_LEVELS). */
  defaultZoomPercent: BoardZoomLevel;
  /** Ctrl (or Cmd) + mouse wheel zooms the board. */
  ctrlScrollZoom: boolean;
  /** Which of the nine toolbar panels the pill toolbar shows. */
  toolbarPanels: Record<BoardPanelId, boolean>;
}

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  layoutMode: null,
  openSize: "full",
  maximizeSnapFull: true,
  maximizeDoubleClickHeader: true,
  newPanelPlacement: "where-you-are",
  layoutMemory: "per-project",
  defaultZoomPercent: 100,
  ctrlScrollZoom: true,
  toolbarPanels: {
    chat: true,
    preview: true,
    code: true,
    terminal: true,
    files: true,
    health: true,
    deploy: true,
    media: true,
    browser: true,
    activity: false,
    world: false,
  },
};

interface BoardSettingsStore extends BoardSettings {
  setLayoutMode: (mode: StudioLayoutMode) => void;
  setOpenSize: (mode: BoardOpenSizeMode) => void;
  setMaximizeSnapFull: (on: boolean) => void;
  setMaximizeDoubleClickHeader: (on: boolean) => void;
  setNewPanelPlacement: (placement: BoardNewPanelPlacement) => void;
  setLayoutMemory: (memory: BoardLayoutMemory) => void;
  setDefaultZoomPercent: (percent: number) => void;
  setCtrlScrollZoom: (on: boolean) => void;
  setToolbarPanelVisible: (id: BoardPanelId, visible: boolean) => void;
  resetBoardSettings: () => void;
}

function coerceZoomLevel(value: unknown): BoardZoomLevel {
  return (BOARD_ZOOM_LEVELS as readonly number[]).includes(value as number)
    ? (value as BoardZoomLevel)
    : 100;
}

/** Defensive merge (same pattern as useFollowModeStore): corrupted or
 *  legacy persisted values coerce back to valid settings instead of
 *  breaking the board. */
function mergeBoardSettings(persisted: unknown, current: BoardSettingsStore): BoardSettingsStore {
  if (!persisted || typeof persisted !== "object") return current;
  const p = persisted as Partial<BoardSettings>;
  const toolbarPanels = { ...DEFAULT_BOARD_SETTINGS.toolbarPanels };
  if (p.toolbarPanels && typeof p.toolbarPanels === "object") {
    for (const id of BOARD_TOOLBAR_PANEL_IDS) {
      if (typeof p.toolbarPanels[id] === "boolean") toolbarPanels[id] = p.toolbarPanels[id];
    }
  }
  return {
    ...current,
    layoutMode:
      p.layoutMode === "board" || p.layoutMode === "classic" || p.layoutMode === null
        ? p.layoutMode
        : current.layoutMode,
    openSize:
      p.openSize === "remember" || p.openSize === "smart" || p.openSize === "full"
        ? p.openSize
        : current.openSize,
    maximizeSnapFull:
      typeof p.maximizeSnapFull === "boolean" ? p.maximizeSnapFull : current.maximizeSnapFull,
    maximizeDoubleClickHeader:
      typeof p.maximizeDoubleClickHeader === "boolean"
        ? p.maximizeDoubleClickHeader
        : current.maximizeDoubleClickHeader,
    newPanelPlacement:
      p.newPanelPlacement === "center" ||
      p.newPanelPlacement === "where-you-are" ||
      p.newPanelPlacement === "tile"
        ? p.newPanelPlacement
        : current.newPanelPlacement,
    layoutMemory:
      p.layoutMemory === "fresh" || p.layoutMemory === "per-project"
        ? p.layoutMemory
        : current.layoutMemory,
    defaultZoomPercent:
      p.defaultZoomPercent === undefined
        ? current.defaultZoomPercent
        : coerceZoomLevel(p.defaultZoomPercent),
    ctrlScrollZoom:
      typeof p.ctrlScrollZoom === "boolean" ? p.ctrlScrollZoom : current.ctrlScrollZoom,
    toolbarPanels,
  };
}

export const useBoardSettingsStore = create<BoardSettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_BOARD_SETTINGS,
      toolbarPanels: { ...DEFAULT_BOARD_SETTINGS.toolbarPanels },

      setLayoutMode: (mode) =>
        set({ layoutMode: mode === "classic" ? "classic" : "board" }),
      setOpenSize: (mode) =>
        set({
          openSize:
            mode === "remember" || mode === "smart" || mode === "full" ? mode : "full",
        }),
      setMaximizeSnapFull: (on) => set({ maximizeSnapFull: Boolean(on) }),
      setMaximizeDoubleClickHeader: (on) => set({ maximizeDoubleClickHeader: Boolean(on) }),
      setNewPanelPlacement: (placement) =>
        set({
          newPanelPlacement:
            placement === "center" || placement === "where-you-are" || placement === "tile"
              ? placement
              : "where-you-are",
        }),
      setLayoutMemory: (memory) =>
        set({ layoutMemory: memory === "fresh" || memory === "per-project" ? memory : "per-project" }),
      setDefaultZoomPercent: (percent) => set({ defaultZoomPercent: coerceZoomLevel(percent) }),
      setCtrlScrollZoom: (on) => set({ ctrlScrollZoom: Boolean(on) }),
      setToolbarPanelVisible: (id, visible) =>
        set((s) => ({ toolbarPanels: { ...s.toolbarPanels, [id]: Boolean(visible) } })),
      resetBoardSettings: () =>
        set({ ...DEFAULT_BOARD_SETTINGS, toolbarPanels: { ...DEFAULT_BOARD_SETTINGS.toolbarPanels } }),
    }),
    {
      name: BOARD_SETTINGS_STORAGE_KEY,
      version: 1,
      merge: mergeBoardSettings,
      partialize: (s) => ({
        layoutMode: s.layoutMode,
        openSize: s.openSize,
        maximizeSnapFull: s.maximizeSnapFull,
        maximizeDoubleClickHeader: s.maximizeDoubleClickHeader,
        newPanelPlacement: s.newPanelPlacement,
        layoutMemory: s.layoutMemory,
        defaultZoomPercent: s.defaultZoomPercent,
        ctrlScrollZoom: s.ctrlScrollZoom,
        toolbarPanels: s.toolbarPanels,
      }),
    },
  ),
);

/** The open-behavior slice of the settings, in one plain object. */
export interface BoardOpenBehavior {
  openSize: BoardOpenSizeMode;
  newPanelPlacement: BoardNewPanelPlacement;
  layoutMemory: BoardLayoutMemory;
  maximizeSnapFull: boolean;
  maximizeDoubleClickHeader: boolean;
}

/**
 * Plain hook-free getter for the open-behavior settings — the layout
 * store (useBoardLayoutStore) reads this at summon/maximize time when
 * the lanes integrate, the same way follow-navigation reads
 * useFollowModeStore.getState(). No React required.
 */
export function getBoardOpenBehavior(): BoardOpenBehavior {
  const s = useBoardSettingsStore.getState();
  return {
    openSize: s.openSize,
    newPanelPlacement: s.newPanelPlacement,
    layoutMemory: s.layoutMemory,
    maximizeSnapFull: s.maximizeSnapFull,
    maximizeDoubleClickHeader: s.maximizeDoubleClickHeader,
  };
}

/** Plain hook-free snapshot of every board setting. */
export function getBoardSettings(): BoardSettings {
  const s = useBoardSettingsStore.getState();
  return {
    layoutMode: s.layoutMode,
    openSize: s.openSize,
    maximizeSnapFull: s.maximizeSnapFull,
    maximizeDoubleClickHeader: s.maximizeDoubleClickHeader,
    newPanelPlacement: s.newPanelPlacement,
    layoutMemory: s.layoutMemory,
    defaultZoomPercent: s.defaultZoomPercent,
    ctrlScrollZoom: s.ctrlScrollZoom,
    toolbarPanels: { ...s.toolbarPanels },
  };
}
