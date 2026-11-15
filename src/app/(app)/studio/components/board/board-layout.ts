/**
 * Board mode — pure layout geometry (plan §2 B1/B2 + additions).
 *
 * Everything here is a pure function over plain data so the store and the
 * components stay thin and the geometry is unit-testable without a DOM.
 */

import {
  BOARD_MIN_PANEL_HEIGHT,
  BOARD_MIN_PANEL_WIDTH,
  BOARD_PANEL_IDS,
  BOARD_PANEL_INVENTORY,
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

/** The prototype-default arrangement for a project type. */
export function defaultBoardLayout(projectType: BoardProjectType): BoardLayoutState {
  const panels = {} as Record<BoardPanelId, BoardPanelState>;
  let z = 0;
  for (const def of BOARD_PANEL_INVENTORY) {
    z += 1;
    panels[def.id] = {
      id: def.id,
      rect: { ...def.defaultRect },
      z,
      open: def.defaultOpenFor.includes(projectType),
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
 * Clamp every panel so it stays REACHABLE inside a visible area
 * (board-only acceptance rule: on window shrink, panels clamp back
 * inside the viewport instead of stranding off-canvas — the right-edge
 * strip defect's replacement behavior). A panel keeps at least its
 * header band plus a grabbable slice on screen; width/height shrink to
 * the area when the area itself is smaller than the panel. Pure.
 */
export function clampPanelsToArea(
  panels: Record<BoardPanelId, BoardPanelState>,
  area: { width: number; height: number },
): Record<BoardPanelId, BoardPanelState> {
  const REACHABLE_X = 160; // at least this much of the panel stays visible
  const REACHABLE_Y = 48; // header band height — the drag handle stays grabbable
  const next = {} as Record<BoardPanelId, BoardPanelState>;
  for (const id of BOARD_PANEL_IDS) {
    const panel = panels[id];
    const maxWidth = Math.max(area.width, BOARD_MIN_PANEL_WIDTH);
    const maxHeight = Math.max(area.height, BOARD_MIN_PANEL_HEIGHT);
    const width = Math.min(Math.max(panel.rect.width, BOARD_MIN_PANEL_WIDTH), maxWidth);
    const height = Math.min(Math.max(panel.rect.height, BOARD_MIN_PANEL_HEIGHT), maxHeight);
    const maxX = Math.max(0, area.width - REACHABLE_X);
    const maxY = Math.max(0, area.height - REACHABLE_Y);
    next[id] = {
      ...panel,
      rect: {
        x: Math.min(Math.max(0, panel.rect.x), maxX),
        y: Math.min(Math.max(0, panel.rect.y), maxY),
        width,
        height,
      },
    };
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
