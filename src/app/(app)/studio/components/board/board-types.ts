/**
 * Board mode — shared types (plan §2, BOARD-MODE-AND-FILEWRITE-BUILD-PLAN
 * 2026-11-14, B1/B2 + Larry's approved additions).
 *
 * The board is the dock station on the RIGHT side of Studio: panels float
 * on a dotted infinite-feel canvas and are arranged only by the user's own
 * hand (or by LiTT on the user's explicit in-chat ask — the one approved
 * exception; the system never moves panels on its own initiative).
 *
 * Chat is NOT a board panel: it stays fixed on the left, bright and open
 * on the Chat tab (standing layout rule).
 */

export type BoardPanelId =
  | "preview"
  | "code"
  | "files"
  | "terminal"
  | "health"
  | "inspector"
  | "deploy"
  | "media"
  | "world";

export type BoardProjectType = "website" | "game";

export interface BoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardPanelState {
  id: BoardPanelId;
  rect: BoardRect;
  /** Stacking order — higher is closer to the front. */
  z: number;
  open: boolean;
  minimized: boolean;
  maximized: boolean;
  /** Rect to restore to when un-maximizing / restoring from the tray. */
  restoreRect: BoardRect | null;
}

export interface BoardViewport {
  panX: number;
  panY: number;
  /** 1 = 100%. The zoom-out overview drives this below 1. */
  scale: number;
}

/** A named, user-saved arrangement (additions: multiple presets, not one). */
export interface BoardPreset {
  name: string;
  savedAt: number;
  panels: Record<BoardPanelId, BoardPanelState>;
}

export interface BoardLayoutState {
  projectType: BoardProjectType;
  panels: Record<BoardPanelId, BoardPanelState>;
  presets: Record<string, BoardPreset>;
  activePresetName: string | null;
  viewport: BoardViewport;
  /** Viewport captured when the zoom-out overview engaged, for return. */
  overviewReturnViewport: BoardViewport | null;
}

export interface BoardPanelDefinition {
  id: BoardPanelId;
  title: string;
  defaultRect: BoardRect;
  /** Open in the default layout for this project type. */
  defaultOpenFor: BoardProjectType[];
  /** One-line honest note about what binds here in B3 (no fake systems). */
  bindingNote: string;
}

/**
 * The frozen panel inventory (B0/B2). Order here is the tray/toolbar order.
 * Default rects assume a ~1600×900 board coordinate space and mirror the
 * prototype: Preview center, Code right-top, Terminal right-bottom.
 */
export const BOARD_PANEL_INVENTORY: BoardPanelDefinition[] = [
  {
    id: "preview",
    title: "Preview",
    defaultRect: { x: 24, y: 24, width: 760, height: 520 },
    defaultOpenFor: ["website", "game"],
    bindingNote: "Binds to StudioPreviewPanel — the real active project, live.",
  },
  {
    id: "code",
    title: "Code",
    defaultRect: { x: 808, y: 24, width: 560, height: 400 },
    defaultOpenFor: ["website", "game"],
    bindingNote: "Binds to the Studio Code surface on the shared project store.",
  },
  {
    id: "terminal",
    title: "Terminal / Logs",
    defaultRect: { x: 808, y: 448, width: 560, height: 300 },
    defaultOpenFor: ["website"],
    bindingNote: "Binds to sandbox exec + logs (interactive PTY is its own lane, D1).",
  },
  {
    id: "files",
    title: "Files",
    defaultRect: { x: 24, y: 568, width: 380, height: 320 },
    defaultOpenFor: [],
    bindingNote: "Binds to StudioProjectFiles — same real store as the chat-panel Files tab.",
  },
  {
    id: "health",
    title: "Health",
    defaultRect: { x: 428, y: 568, width: 340, height: 240 },
    defaultOpenFor: [],
    bindingNote: "Binds to StudioHealthPanel runtime state.",
  },
  {
    id: "inspector",
    title: "Inspector",
    defaultRect: { x: 1392, y: 24, width: 384, height: 480 },
    defaultOpenFor: [],
    bindingNote: "Binds to the Inspector (Changes / Checks) content.",
  },
  {
    id: "deploy",
    title: "Deploy",
    defaultRect: { x: 1392, y: 528, width: 384, height: 260 },
    defaultOpenFor: [],
    bindingNote: "Binds to StudioDeploySurface — the real deploy path only.",
  },
  {
    id: "media",
    title: "Media",
    defaultRect: { x: 792, y: 568, width: 420, height: 300 },
    defaultOpenFor: ["game"],
    bindingNote: "The Media stage as a dockable panel — same real asset store as Files.",
  },
  {
    id: "world",
    title: "World",
    defaultRect: { x: 24, y: 24, width: 880, height: 560 },
    defaultOpenFor: ["game"],
    bindingNote:
      "Larry's World panel: the project running live full-bleed with his facecam overlay (camera off by default, his hand only). Streaming/recording are later steps, not v1.",
  },
];

export const BOARD_PANEL_IDS: BoardPanelId[] = BOARD_PANEL_INVENTORY.map((p) => p.id);

export const BOARD_MIN_PANEL_WIDTH = 240;
export const BOARD_MIN_PANEL_HEIGHT = 160;

export function boardDefinition(id: BoardPanelId): BoardPanelDefinition {
  const def = BOARD_PANEL_INVENTORY.find((p) => p.id === id);
  if (!def) throw new Error(`Unknown board panel: ${id}`);
  return def;
}

/** Scope key for per-user + per-project layouts in the store. */
export function boardScopeKey(userId: string, projectId: string): string {
  return `${userId}::${projectId}`;
}
