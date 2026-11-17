/**
 * Board — shared types (plan §2, BOARD-MODE-AND-FILEWRITE-BUILD-PLAN
 * 2026-11-14, B1/B2 + Larry's approved additions; board-only rebuild
 * 2026-11-14 per BOARD-BLUEPRINT.md).
 *
 * The board IS the Studio: it fills the whole window and every surface —
 * chat included — lives on it as a floating panel on a dotted
 * infinite-feel canvas. Panels are arranged only by the user's own hand
 * (or by LiTT on the user's explicit in-chat ask — the one approved
 * exception; the system never moves panels on its own initiative).
 */

export type BoardPanelId =
  | "chat"
  | "preview"
  | "code"
  | "terminal"
  | "files"
  | "health"
  | "deploy"
  | "media"
  | "browser"
  | "activity"
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
 * Panel ids retired by the 2026-11-16 layout spec (Amendments 2–4):
 * Inspector folded away (its keepers — approvals, changes, plans — live
 * in the Chat panel's Jobs tab), and Plan / Canvas moved inside the
 * Code box. Persisted layouts and presets may still carry these ids;
 * the store migration drops them gracefully. Game World ("world")
 * stays its own panel — Larry has not decided its fate.
 */
export const REMOVED_BOARD_PANEL_IDS: readonly string[] = ["inspector", "plan", "canvas"];

/**
 * Chat's pre-centering default rect. This exact value is the
 * "untouched default" signature the layout v5 migration matches on: a
 * persisted chat panel still sitting at precisely this rect was never
 * moved by the user, so the migration may recenter it. Do NOT change
 * this constant without updating the migration to match the OLD value.
 */
export const BOARD_CHAT_UNTOUCHED_DEFAULT_RECT: BoardRect = {
  x: 16,
  y: 16,
  width: 404,
  height: 768,
};

/** The board's design-space area (~1640×800). The layout migration has
 *  no live board area to center against, so it seeds chat centered in
 *  this space; the live board rescues it into view like any panel. */
export const BOARD_DESIGN_AREA = { width: 1640, height: 800 } as const;

/**
 * The panel inventory. Order here is the board toolbar order — the
 * mockup's pill toolbar (Chat, Preview, Code, Terminal, Files, Checks,
 * Deploy, Media, Browser) first, then the remaining panels.
 *
 * Default rects live in a ~1640×800 board coordinate space and mirror
 * Larry's Command Center mockup (1672×941): Chat left full-height,
 * Preview center-large sitting LOWER than the old top-aligned default
 * (y=72, clear of the floating toolbar, drag handle and close button
 * plainly visible), Terminal / Logs under Preview, Files right-top,
 * Media right-bottom. Every default rect fits inside the design space —
 * no panel peeks in from off-canvas (the right-edge strip defect).
 */
export const BOARD_PANEL_INVENTORY: BoardPanelDefinition[] = [
  {
    id: "chat",
    title: "Chat",
    // Stays at the pre-centering default on purpose: this value IS the
    // untouched-default signature the v5 migration matches on (see
    // BOARD_CHAT_UNTOUCHED_DEFAULT_RECT). New scopes are recentered by
    // the migration / area-aware seed, not by changing this constant.
    defaultRect: { ...BOARD_CHAT_UNTOUCHED_DEFAULT_RECT },
    defaultOpenFor: ["website", "game"],
    bindingNote:
      "Binds to the LiTT Command Center — the real conversation (transcript + composer) with Chat / Files tabs and New Chat inside the panel.",
  },
  {
    id: "preview",
    title: "Preview",
    defaultRect: { x: 436, y: 72, width: 700, height: 532 },
    defaultOpenFor: ["website", "game"],
    bindingNote: "Binds to StudioPreviewPanel — the real active project, live.",
  },
  {
    id: "code",
    title: "Code",
    // Grown for the one-box layout (spec §1): file tree + editor +
    // preview side by side need the wider box (mapping §8 / §1.6).
    defaultRect: { x: 436, y: 72, width: 1120, height: 720 },
    defaultOpenFor: [],
    bindingNote: "Binds to the Studio Code surface on the shared project store.",
  },
  {
    id: "terminal",
    title: "Terminal / Logs",
    defaultRect: { x: 436, y: 620, width: 700, height: 164 },
    // Closed until requested (Studio Finish Spec, Larry 2026-11-14):
    // the terminal never opens on its own in the default layout — the
    // user summons it from the toolbar when they want it.
    defaultOpenFor: [],
    bindingNote: "Binds to sandbox exec + logs (interactive PTY is its own lane, D1).",
  },
  {
    id: "files",
    title: "Files",
    defaultRect: { x: 1152, y: 72, width: 436, height: 296 },
    defaultOpenFor: ["website"],
    bindingNote: "Binds to StudioProjectFiles — the project files' one board home.",
  },
  {
    id: "health",
    title: "Checks",
    defaultRect: { x: 1152, y: 72, width: 436, height: 296 },
    defaultOpenFor: [],
    bindingNote:
      "Binds to StudioHealthPanel in checks mode — the board's ONE home for Checks (the Inspector's duplicate Checks tab is not carried into the board).",
  },
  {
    id: "deploy",
    title: "Deploy",
    defaultRect: { x: 1152, y: 384, width: 436, height: 260 },
    defaultOpenFor: [],
    bindingNote: "Binds to StudioDeploySurface — the real deploy path only.",
  },
  {
    id: "media",
    title: "Media",
    defaultRect: { x: 1152, y: 384, width: 436, height: 400 },
    defaultOpenFor: ["website", "game"],
    bindingNote:
      "One panel for images, video and music — the real Asset Lake (GET /api/assets), thumbnails plus viewer/player, and the asset composer.",
  },
  {
    id: "browser",
    title: "Browser",
    defaultRect: { x: 436, y: 72, width: 860, height: 560 },
    defaultOpenFor: [],
    bindingNote: "An embedded web view on the board — look things up without leaving Studio.",
  },
  {
    id: "activity",
    title: "Activity",
    defaultRect: { x: 1152, y: 384, width: 436, height: 320 },
    defaultOpenFor: [],
    bindingNote: "Binds to StudioActivityPanel — its own board panel, never a chat tab.",
  },
  {
    id: "world",
    title: "World",
    defaultRect: { x: 436, y: 72, width: 700, height: 532 },
    defaultOpenFor: ["game"],
    bindingNote:
      "Larry's World panel: the project running live full-bleed with his facecam overlay (camera off by default, his hand only). Streaming/recording are later steps, not v1.",
  },
];

export const BOARD_PANEL_IDS: BoardPanelId[] = BOARD_PANEL_INVENTORY.map((p) => p.id);

/** Violet — the board's accent voice in Larry's Command Center mockup
 *  (active toolbar pill, Generate, active Media tab, modified badges).
 *  Green stays reserved for status signals; pink is not used anywhere. */
export const BOARD_ACCENT_VIOLET = "#7C3AED";

export const BOARD_MIN_PANEL_WIDTH = 240;
/** Smallest usable panel height — a floor for legibility, not a lock:
 *  the bottom edge (and every other edge) resizes freely above it. */
export const BOARD_MIN_PANEL_HEIGHT = 120;

export function boardDefinition(id: BoardPanelId): BoardPanelDefinition {
  const def = BOARD_PANEL_INVENTORY.find((p) => p.id === id);
  if (!def) throw new Error(`Unknown board panel: ${id}`);
  return def;
}

/** Scope key for per-user + per-project layouts in the store. */
export function boardScopeKey(userId: string, projectId: string): string {
  return `${userId}::${projectId}`;
}
