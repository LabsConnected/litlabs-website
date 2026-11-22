/**
 * Board mode — pure layout geometry (plan §2 B1/B2 + additions).
 *
 * Everything here is a pure function over plain data so the store and the
 * components stay thin and the geometry is unit-testable without a DOM.
 */

import {
  BOARD_DESIGN_AREA,
  BOARD_MIN_PANEL_HEIGHT,
  BOARD_MIN_PANEL_WIDTH,
  BOARD_PANEL_IDS,
  BOARD_PANEL_INVENTORY,
  boardDefinition,
  type BoardLayoutState,
  type BoardPanelId,
  type BoardPanelState,
  type BoardProjectType,
  type BoardRect,
  type BoardViewport,
} from "./board-types";

export const DEFAULT_BOARD_VIEWPORT: BoardViewport = { panX: 0, panY: 0, scale: 1 };

export function clampRect(rect: BoardRect): BoardRect {
  return {
    x: Math.round(rect.x),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(BOARD_MIN_PANEL_WIDTH, Math.round(rect.width)),
    height: Math.max(BOARD_MIN_PANEL_HEIGHT, Math.round(rect.height)),
  };
}

/** Top inset for the centered chat anchor — chat sits at the top of
 *  the board area, directly under the project bar (spec §2; the bar
 *  itself is chrome above the board, so "project-bar level" lands
 *  here — mapping §5 flag 1). Matches chat's historical default y. */
export const BOARD_CHAT_TOP_INSET = 16;

/** A board area a seed is computed against: a visible region in board
 *  coordinates (origin + size), or a bare size (origin assumed 0,0). */
export type BoardSeedArea = {
  x?: number;
  y?: number;
  width: number;
  height: number;
};

/**
 * Area-aware seed rect for a panel (mapping §2/§8).
 *
 * Chat is the one anchored panel: within `area` it seeds centered
 * horizontally at the top — centered, NOT jammed next to the project
 * name (Larry, spec §2). Its size is its full default size. Every
 * other panel seeds at its standard default rect verbatim.
 *
 * Pure; never mutates the inventory defaults.
 */
export function seedPanelRect(panelId: BoardPanelId, area: BoardSeedArea): BoardRect {
  const def = boardDefinition(panelId);
  if (panelId !== "chat") return { ...def.defaultRect };
  const originX = area.x ?? 0;
  const originY = area.y ?? 0;
  const centeredX = originX + Math.max(0, Math.round((area.width - def.defaultRect.width) / 2));
  return clampRect({
    x: centeredX,
    y: originY + BOARD_CHAT_TOP_INSET,
    width: def.defaultRect.width,
    height: def.defaultRect.height,
  });
}

/** True when two rects share any area (touching edges do not count). */
export function rectsOverlap(a: BoardRect, b: BoardRect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/**
 * Full-fit clamp: shrink the rect to the area when it is larger, then
 * pull it fully inside the area — every edge, the header band and the
 * header's right-hand controls (minimize / maximize / close) included.
 * This is the drop rule for drags and resizes: a panel may be moved
 * anywhere, but it can never LAND half off the right or bottom edge
 * with its controls cut off (live defect, Larry 2026-11-20 — the
 * Browser panel dropped at the far right edge, half off-screen).
 * Pure; the area is a visible region in board coordinates.
 */
export function clampRectInsideArea(rect: BoardRect, area: BoardSeedArea): BoardRect {
  const originX = area.x ?? 0;
  const originY = area.y ?? 0;
  const width = Math.max(
    1,
    Math.min(Math.max(BOARD_MIN_PANEL_WIDTH, Math.round(rect.width)), Math.round(area.width)),
  );
  const height = Math.max(
    1,
    Math.min(Math.max(BOARD_MIN_PANEL_HEIGHT, Math.round(rect.height)), Math.round(area.height)),
  );
  return {
    x: Math.min(
      Math.max(originX, Math.round(rect.x)),
      originX + Math.max(0, Math.round(area.width) - width),
    ),
    y: Math.min(
      Math.max(originY, Math.round(rect.y)),
      originY + Math.max(0, Math.round(area.height) - height),
    ),
    width,
    height,
  };
}

/** Diagonal offset between placement attempts (window-manager cascade). */
export const BOARD_PLACEMENT_STEP = 36;

/**
 * Placement search for a panel about to appear: starting from the
 * desired rect, find a position inside `area` that does not stack the
 * panel on the occupied ones. Several inventory defaults share one
 * rect (preview / code / browser / world all seed at 436,72), so a
 * panel summoned at its untouched default landed EXACTLY on an
 * already-open panel and buried it (live defect, Larry 2026-11-20 —
 * Static View opened covering Chat). Preference order: the desired
 * spot when it is free, a diagonal cascade off it, then a row-major
 * scan of the area. When the area is too crowded for a free spot, the
 * least-overlapping cascade candidate wins — never an exact stack
 * while any offset exists. Pure; deterministic.
 */
export function findOpenPosition(
  desired: BoardRect,
  occupied: BoardRect[],
  area: BoardSeedArea,
): BoardRect {
  const first = clampRectInsideArea(desired, area);
  if (!occupied.some((o) => rectsOverlap(first, o))) return first;

  const overlapArea = (r: BoardRect) =>
    occupied.reduce((sum, o) => {
      const w = Math.min(r.x + r.width, o.x + o.width) - Math.max(r.x, o.x);
      const h = Math.min(r.y + r.height, o.y + o.height) - Math.max(r.y, o.y);
      return sum + (w > 0 && h > 0 ? w * h : 0);
    }, 0);
  // An exact stack (same top-left as an occupied panel) is the defect
  // being fixed — penalize it past any partial overlap.
  const score = (r: BoardRect) =>
    overlapArea(r) + (occupied.some((o) => o.x === r.x && o.y === r.y) ? Number.MAX_SAFE_INTEGER : 0);

  let best = first;
  let bestScore = score(first);
  const consider = (candidate: BoardRect): BoardRect | null => {
    if (!occupied.some((o) => rectsOverlap(candidate, o))) return candidate;
    const s = score(candidate);
    if (s < bestScore) {
      best = candidate;
      bestScore = s;
    }
    return null;
  };

  for (let k = 1; k <= 12; k++) {
    const hit = consider(
      clampRectInsideArea(
        {
          ...desired,
          x: desired.x + k * BOARD_PLACEMENT_STEP,
          y: desired.y + k * BOARD_PLACEMENT_STEP,
        },
        area,
      ),
    );
    if (hit) return hit;
  }

  const originX = area.x ?? 0;
  const originY = area.y ?? 0;
  const scanStep = 48;
  for (let y = originY; y + first.height <= originY + area.height; y += scanStep) {
    for (let x = originX; x + first.width <= originX + area.width; x += scanStep) {
      const hit = consider({ x, y, width: first.width, height: first.height });
      if (hit) return hit;
    }
  }
  return best;
}

/** The prototype-default arrangement for a project type. */
export function defaultBoardLayout(projectType: BoardProjectType): BoardLayoutState {
  const panels = {} as Record<BoardPanelId, BoardPanelState>;
  const placedOpen: BoardRect[] = [];
  let z = 0;
  for (const def of BOARD_PANEL_INVENTORY) {
    z += 1;
    const open = def.defaultOpenFor.includes(projectType);
    let rect = { ...def.defaultRect };
    // Default-open panels must not open stacked on each other (the
    // game default seeds World at exactly Preview's rect). A panel a
    // project type does not open keeps its inventory rect verbatim —
    // its placement is decided when it is summoned.
    if (open) {
      rect = findOpenPosition(rect, placedOpen, BOARD_DESIGN_AREA);
      placedOpen.push(rect);
    }
    panels[def.id] = {
      id: def.id,
      rect,
      z,
      open,
      minimized: false,
      maximized: false,
      restoreRect: null,
    };
  }
  return {
    projectType,
    panels,
    presets: {},
    activePresetName: null,
    viewport: { ...DEFAULT_BOARD_VIEWPORT },
    overviewReturnViewport: null,
  };
}

/**
 * Clamp every panel FULLY inside a visible area (board-only
 * acceptance rule: on window shrink, panels clamp back inside the
 * viewport instead of stranding off-canvas). The earlier rule only
 * kept a reachable slice on screen — a wide panel could still sit
 * with its header controls (close button) past the right edge, which
 * is the half-buried drop defect (Larry, 2026-11-20). Full-fit via
 * clampRectInsideArea: the whole panel, controls included, lands
 * inside the area; width/height shrink to the area when the area
 * itself is smaller than the panel. Pure.
 */
export function clampPanelsToArea(
  panels: Record<BoardPanelId, BoardPanelState>,
  area: { width: number; height: number },
): Record<BoardPanelId, BoardPanelState> {
  const next = {} as Record<BoardPanelId, BoardPanelState>;
  for (const id of BOARD_PANEL_IDS) {
    const panel = panels[id];
    next[id] = { ...panel, rect: clampRectInsideArea(panel.rect, area) };
  }
  return next;
}

export function visiblePanels(layout: BoardLayoutState): BoardPanelState[] {
  return Object.values(layout.panels)
    .filter((p) => p.open && !p.minimized)
    .sort((a, b) => a.z - b.z);
}

export function topZ(layout: BoardLayoutState): number {
  return Object.values(layout.panels).reduce((max, p) => Math.max(max, p.z), 0);
}

/**
 * Tidy (additions — user-invoked only): snap every open, non-minimized
 * panel into a clean grid inside `area`, in z reading order. Maximized
 * panels are restored first (their restoreRect wins over the grid cell).
 * Returns a new panels record; inputs are not mutated.
 */
export function tidyPanels(
  panels: Record<BoardPanelId, BoardPanelState>,
  area: { width: number; height: number },
  gap = 12,
  padding = 16,
): Record<BoardPanelId, BoardPanelState> {
  const targets = Object.values(panels)
    .filter((p) => p.open && !p.minimized)
    .sort((a, b) => a.z - b.z);
  const next: Record<BoardPanelId, BoardPanelState> = { ...panels };
  if (targets.length === 0) return next;

  const usableW = Math.max(0, area.width - padding * 2);
  const usableH = Math.max(0, area.height - padding * 2);
  const cols = Math.max(1, Math.ceil(Math.sqrt(targets.length * (usableW / Math.max(usableH, 1)))));
  const rows = Math.max(1, Math.ceil(targets.length / cols));
  const cellW = (usableW - gap * (cols - 1)) / cols;
  const cellH = (usableH - gap * (rows - 1)) / rows;

  targets.forEach((panel, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    next[panel.id] = {
      ...panel,
      maximized: false,
      restoreRect: null,
      rect: clampRect({
        x: padding + col * (cellW + gap),
        y: padding + row * (cellH + gap),
        width: cellW,
        height: cellH,
      }),
    };
  });
  return next;
}

/** Bounding box of the open, non-minimized panels (null when none). */
export function panelsBoundingBox(
  panels: Record<BoardPanelId, BoardPanelState>,
): BoardRect | null {
  const visible = Object.values(panels).filter((p) => p.open && !p.minimized);
  if (visible.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of visible) {
    minX = Math.min(minX, p.rect.x);
    minY = Math.min(minY, p.rect.y);
    maxX = Math.max(maxX, p.rect.x + p.rect.width);
    maxY = Math.max(maxY, p.rect.y + p.rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Zoom-out overview (additions): the viewport that frames every open
 * panel inside the container, scale clamped to [0.1, 1] — overview only
 * ever zooms OUT (or stays), never in past 100%.
 */
export function overviewViewport(
  panels: Record<BoardPanelId, BoardPanelState>,
  container: { width: number; height: number },
  margin = 32,
): BoardViewport {
  const bbox = panelsBoundingBox(panels);
  if (!bbox) return { ...DEFAULT_BOARD_VIEWPORT };
  const availW = Math.max(1, container.width - margin * 2);
  const availH = Math.max(1, container.height - margin * 2);
  const scale = Math.min(1, Math.max(0.1, Math.min(availW / bbox.width, availH / bbox.height)));
  const panX = margin + (availW - bbox.width * scale) / 2 - bbox.x * scale;
  const panY = margin + (availH - bbox.height * scale) / 2 - bbox.y * scale;
  return { panX: Math.round(panX), panY: Math.round(panY), scale: Math.round(scale * 1000) / 1000 };
}

/**
 * Fit on open (Larry, 2026-11-22): the camera a board should start
 * with when it first mounts. Returns null when every open panel
 * already fits inside the container at the stored viewport — the
 * stored camera is then left exactly as it is. Otherwise returns the
 * same framing the zoom control's "Fit" entry computes
 * (overviewViewport), so the board opens showing everything instead
 * of panels stranded past the window's edges at 100%.
 *
 * CAMERA ONLY: this never rewrites a panel rect — saved positions
 * and sizes move only on user action (standing rule). Pure.
 */
export function fitOnOpenViewport(
  panels: Record<BoardPanelId, BoardPanelState>,
  viewport: BoardViewport,
  container: { width: number; height: number },
): BoardViewport | null {
  if (container.width <= 0 || container.height <= 0) return null;
  const bbox = panelsBoundingBox(panels);
  if (!bbox) return null;
  const scale = viewport.scale || 1;
  const left = bbox.x * scale + viewport.panX;
  const top = bbox.y * scale + viewport.panY;
  const right = (bbox.x + bbox.width) * scale + viewport.panX;
  const bottom = (bbox.y + bbox.height) * scale + viewport.panY;
  // 1px of slack so a bbox that lands exactly on the container edge
  // (rounding) counts as fitting and the stored camera survives.
  const EPSILON = 1;
  if (
    left >= -EPSILON &&
    top >= -EPSILON &&
    right <= container.width + EPSILON &&
    bottom <= container.height + EPSILON
  ) {
    return null;
  }
  return overviewViewport(panels, container);
}
