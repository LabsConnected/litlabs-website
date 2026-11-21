import { describe, expect, it } from "vitest";
import {
  BOARD_CHAT_TOP_INSET,
  clampPanelsToArea,
  clampRect,
  clampRectInsideArea,
  defaultBoardLayout,
  findOpenPosition,
  overviewViewport,
  panelsBoundingBox,
  rectsOverlap,
  seedPanelRect,
  tidyPanels,
  visiblePanels,
} from "./board-layout";
import {
  BOARD_CHAT_UNTOUCHED_DEFAULT_RECT,
  BOARD_PANEL_IDS,
  boardDefinition,
} from "./board-types";

describe("defaultBoardLayout", () => {
  it("contains the full frozen panel inventory", () => {
    const layout = defaultBoardLayout("website");
    expect(Object.keys(layout.panels).sort()).toEqual([...BOARD_PANEL_IDS].sort());
  });

  it("website default opens the mockup arrangement: Chat, Preview, Files and Media — Terminal stays closed until requested", () => {
    const layout = defaultBoardLayout("website");
    expect(layout.panels.chat.open).toBe(true);
    expect(layout.panels.preview.open).toBe(true);
    expect(layout.panels.terminal.open).toBe(false);
    expect(layout.panels.files.open).toBe(true);
    expect(layout.panels.media.open).toBe(true);
    expect(layout.panels.code.open).toBe(false);
    expect(layout.panels.health.open).toBe(false);
    expect(layout.panels.deploy.open).toBe(false);
    expect(layout.panels.browser.open).toBe(false);
    expect(layout.panels.world.open).toBe(false);
  });

  it("every default rect fits inside the design space — no panel peeks in from off-canvas (right-edge strip defect)", () => {
    for (const type of ["website", "game"] as const) {
      const layout = defaultBoardLayout(type);
      for (const panel of Object.values(layout.panels)) {
        expect(panel.rect.x).toBeGreaterThanOrEqual(0);
        expect(panel.rect.y).toBeGreaterThanOrEqual(0);
        expect(panel.rect.x + panel.rect.width).toBeLessThanOrEqual(1640);
        expect(panel.rect.y + panel.rect.height).toBeLessThanOrEqual(800);
      }
    }
  });

  it("the Preview default sits lower on the board so its drag handle and close button clear the floating toolbar", () => {
    const layout = defaultBoardLayout("website");
    expect(layout.panels.preview.rect.y).toBeGreaterThanOrEqual(64);
  });

  it("game default opens the World panel and Media (project-type panel sets)", () => {
    const layout = defaultBoardLayout("game");
    expect(layout.panels.world.open).toBe(true);
    expect(layout.panels.media.open).toBe(true);
    expect(layout.panels.preview.open).toBe(true);
  });

  it("starts at the identity viewport with no presets", () => {
    const layout = defaultBoardLayout("website");
    expect(layout.viewport).toEqual({ panX: 0, panY: 0, scale: 1 });
    expect(layout.presets).toEqual({});
    expect(layout.activePresetName).toBeNull();
  });
});

describe("panel inventory (2026-11-16 layout spec)", () => {
  it("retires inspector, plan and canvas; world stays its own panel", () => {
    for (const removed of ["inspector", "plan", "canvas"]) {
      expect(BOARD_PANEL_IDS).not.toContain(removed);
    }
    expect(BOARD_PANEL_IDS).toContain("world");
    const layout = defaultBoardLayout("website");
    expect(layout.panels).not.toHaveProperty("inspector");
    expect(layout.panels).not.toHaveProperty("plan");
    expect(layout.panels).not.toHaveProperty("canvas");
    expect(layout.panels.world).toBeDefined();
  });

  it("code opens at the one-box size 1120×720", () => {
    expect(boardDefinition("code").defaultRect).toEqual({
      x: 436,
      y: 72,
      width: 1120,
      height: 720,
    });
    expect(defaultBoardLayout("website").panels.code.rect.width).toBe(1120);
    expect(defaultBoardLayout("website").panels.code.rect.height).toBe(720);
  });

  it("chat's default rect stays the untouched-default signature the v5 migration matches on", () => {
    expect(boardDefinition("chat").defaultRect).toEqual(BOARD_CHAT_UNTOUCHED_DEFAULT_RECT);
    expect(BOARD_CHAT_UNTOUCHED_DEFAULT_RECT).toEqual({ x: 16, y: 16, width: 404, height: 768 });
  });
});

describe("seedPanelRect", () => {
  it("seeds chat centered horizontally at the top of the area, at full default size", () => {
    const rect = seedPanelRect("chat", { width: 1640, height: 800 });
    expect(rect).toEqual({
      x: Math.round((1640 - 404) / 2),
      y: BOARD_CHAT_TOP_INSET,
      width: 404,
      height: 768,
    });
    // Genuinely centered: equal margins on both sides.
    expect(rect.x).toBe(1640 - (rect.x + rect.width));
  });

  it("centers chat within an offset visible region (panned board)", () => {
    const rect = seedPanelRect("chat", { x: 200, y: 50, width: 1200, height: 700 });
    expect(rect.x).toBe(200 + Math.round((1200 - 404) / 2));
    expect(rect.y).toBe(50 + BOARD_CHAT_TOP_INSET);
    expect(rect.width).toBe(404);
    expect(rect.height).toBe(768);
  });

  it("keeps chat at the area's left edge when the area is narrower than the panel", () => {
    const rect = seedPanelRect("chat", { x: 30, y: 0, width: 300, height: 600 });
    expect(rect.x).toBe(30);
    expect(rect.width).toBe(404);
  });

  it("seeds every other panel at its standard default rect verbatim", () => {
    for (const id of BOARD_PANEL_IDS) {
      if (id === "chat") continue;
      expect(seedPanelRect(id, { x: 200, y: 50, width: 1200, height: 700 })).toEqual(
        boardDefinition(id).defaultRect,
      );
    }
  });

  it("does not mutate the inventory defaults", () => {
    seedPanelRect("chat", { width: 1000, height: 800 });
    seedPanelRect("code", { width: 1000, height: 800 });
    expect(boardDefinition("chat").defaultRect).toEqual(BOARD_CHAT_UNTOUCHED_DEFAULT_RECT);
    expect(boardDefinition("code").defaultRect.width).toBe(1120);
  });
});

describe("clampRect", () => {
  it("enforces minimum panel size and a non-negative y", () => {
    expect(clampRect({ x: 10.4, y: -5, width: 10, height: 10 })).toEqual({
      x: 10,
      y: 0,
      width: 240,
      height: 120,
    });
  });
});

describe("tidyPanels", () => {
  it("snaps open panels into a clean non-overlapping grid inside the area", () => {
    const layout = defaultBoardLayout("website");
    const tidied = tidyPanels(layout.panels, { width: 1200, height: 800 });
    const visible = visiblePanels({ ...layout, panels: tidied });
    expect(visible.length).toBe(Object.values(layout.panels).filter((p) => p.open).length);
    for (const panel of visible) {
      expect(panel.rect.x).toBeGreaterThanOrEqual(0);
      expect(panel.rect.y).toBeGreaterThanOrEqual(0);
      expect(panel.rect.x + panel.rect.width).toBeLessThanOrEqual(1200);
      expect(panel.rect.y + panel.rect.height).toBeLessThanOrEqual(800);
    }
    // No two tidied panels overlap.
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = visible[i].rect;
        const b = visible[j].rect;
        const overlap =
          a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
  });

  it("leaves closed and minimized panels untouched and does not mutate input", () => {
    const layout = defaultBoardLayout("website");
    // Code is closed in the website default; Files is open, so mark it
    // minimized to cover the minimized case.
    layout.panels.files = { ...layout.panels.files, minimized: true };
    const codeBefore = layout.panels.code;
    const filesBefore = layout.panels.files;
    const tidied = tidyPanels(layout.panels, { width: 1200, height: 800 });
    expect(tidied.code).toBe(codeBefore);
    expect(tidied.files).toBe(filesBefore);
    expect(layout.panels.preview.rect).toEqual({ x: 436, y: 72, width: 700, height: 532 });
  });

  it("un-maximizes a maximized panel into its grid cell", () => {
    const layout = defaultBoardLayout("website");
    layout.panels.preview = {
      ...layout.panels.preview,
      maximized: true,
      restoreRect: { x: 1, y: 1, width: 300, height: 200 },
      rect: { x: 0, y: 0, width: 1200, height: 800 },
    };
    const tidied = tidyPanels(layout.panels, { width: 1200, height: 800 });
    expect(tidied.preview.maximized).toBe(false);
    expect(tidied.preview.restoreRect).toBeNull();
    expect(tidied.preview.rect.width).toBeLessThan(1200);
  });
});

describe("clampPanelsToArea", () => {
  it("pulls a stranded panel back within reach of a shrunken area", () => {
    const layout = defaultBoardLayout("website");
    layout.panels.files = {
      ...layout.panels.files,
      rect: { x: 1500, y: 700, width: 436, height: 296 },
    };
    const clamped = clampPanelsToArea(layout.panels, { width: 900, height: 600 });
    expect(clamped.files.rect.x).toBeLessThanOrEqual(900 - 160);
    expect(clamped.files.rect.y).toBeLessThanOrEqual(600 - 48);
    expect(clamped.files.rect.x).toBeGreaterThanOrEqual(0);
    expect(clamped.files.rect.y).toBeGreaterThanOrEqual(0);
  });

  it("shrinks a panel larger than the area down to the area", () => {
    const layout = defaultBoardLayout("website");
    const clamped = clampPanelsToArea(layout.panels, { width: 500, height: 400 });
    expect(clamped.preview.rect.width).toBeLessThanOrEqual(500);
    expect(clamped.preview.rect.height).toBeLessThanOrEqual(400);
  });

  it("leaves a reachable panel exactly where it is", () => {
    const layout = defaultBoardLayout("website");
    const clamped = clampPanelsToArea(layout.panels, { width: 1640, height: 800 });
    expect(clamped.preview.rect).toEqual(layout.panels.preview.rect);
    expect(clamped.chat.rect).toEqual(layout.panels.chat.rect);
  });
});

describe("clampRectInsideArea (drop clamp)", () => {
  const area = { width: 1200, height: 800 };

  it("pulls a panel dropped off the right edge fully back inside — close button included", () => {
    const clamped = clampRectInsideArea({ x: 1100, y: 100, width: 436, height: 296 }, area);
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(1200);
    expect(clamped.x).toBe(1200 - 436);
    expect(clamped.y).toBe(100);
  });

  it("pulls a panel dropped off the bottom edge fully back inside", () => {
    const clamped = clampRectInsideArea({ x: 100, y: 750, width: 436, height: 296 }, area);
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(800);
    expect(clamped.y).toBe(800 - 296);
  });

  it("pulls a panel dropped off the left or top edge back to the origin", () => {
    const clamped = clampRectInsideArea({ x: -300, y: -40, width: 436, height: 296 }, area);
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
  });

  it("shrinks a panel larger than the area to the area and pins it to the origin", () => {
    const clamped = clampRectInsideArea({ x: 50, y: 50, width: 1600, height: 1000 }, area);
    expect(clamped).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  });

  it("clamps inside an offset visible region (panned board)", () => {
    const region = { x: 200, y: 50, width: 1000, height: 700 };
    const clamped = clampRectInsideArea({ x: 1150, y: 700, width: 436, height: 296 }, region);
    expect(clamped.x).toBeGreaterThanOrEqual(200);
    expect(clamped.y).toBeGreaterThanOrEqual(50);
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(1200);
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(750);
  });

  it("leaves a rect already fully inside exactly where it is", () => {
    const rect = { x: 436, y: 72, width: 700, height: 532 };
    expect(clampRectInsideArea(rect, { width: 1640, height: 800 })).toEqual(rect);
  });
});

describe("findOpenPosition (placement search)", () => {
  const area = { width: 1640, height: 800 };

  it("returns the desired rect when nothing occupies it", () => {
    const desired = { x: 436, y: 72, width: 700, height: 532 };
    expect(findOpenPosition(desired, [], area)).toEqual(desired);
  });

  it("does not stack a panel exactly on an occupied one (shared default rect)", () => {
    const preview = { x: 436, y: 72, width: 700, height: 532 };
    const placed = findOpenPosition({ ...preview }, [preview], area);
    expect(placed.x === preview.x && placed.y === preview.y).toBe(false);
    // Wherever it lands, it lands fully inside the area — header and
    // close button reachable.
    expect(placed.x).toBeGreaterThanOrEqual(0);
    expect(placed.y).toBeGreaterThanOrEqual(0);
    expect(placed.x + placed.width).toBeLessThanOrEqual(area.width);
    expect(placed.y + placed.height).toBeLessThanOrEqual(area.height);
  });

  it("finds a fully free spot when the area has room", () => {
    const occupied = [{ x: 0, y: 0, width: 400, height: 800 }];
    const placed = findOpenPosition({ x: 0, y: 0, width: 300, height: 200 }, occupied, area);
    expect(rectsOverlap(placed, occupied[0])).toBe(false);
  });

  it("the game default no longer opens World stacked exactly on Preview", () => {
    const layout = defaultBoardLayout("game");
    const world = layout.panels.world.rect;
    const preview = layout.panels.preview.rect;
    expect(layout.panels.world.open).toBe(true);
    expect(world.x === preview.x && world.y === preview.y).toBe(false);
    expect(world.x + world.width).toBeLessThanOrEqual(1640);
    expect(world.y + world.height).toBeLessThanOrEqual(800);
  });
});

describe("clampPanelsToArea — full-fit rescue", () => {
  it("a panel half-buried off the right/bottom comes back fully inside, controls included", () => {
    const layout = defaultBoardLayout("website");
    layout.panels.browser = {
      ...layout.panels.browser,
      open: true,
      rect: { x: 1500, y: 700, width: 860, height: 560 },
    };
    const clamped = clampPanelsToArea(layout.panels, { width: 1280, height: 720 });
    expect(clamped.browser.rect.x + clamped.browser.rect.width).toBeLessThanOrEqual(1280);
    expect(clamped.browser.rect.y + clamped.browser.rect.height).toBeLessThanOrEqual(720);
    expect(clamped.browser.rect.x).toBeGreaterThanOrEqual(0);
    expect(clamped.browser.rect.y).toBeGreaterThanOrEqual(0);
  });
});

describe("overviewViewport", () => {
  it("zooms out (never in past 1) to frame every open panel", () => {
    const layout = defaultBoardLayout("website");
    const overview = overviewViewport(layout.panels, { width: 800, height: 600 });
    expect(overview.scale).toBeLessThan(1);
    expect(overview.scale).toBeGreaterThanOrEqual(0.1);
    // The whole bounding box lands inside the container.
    const bbox = panelsBoundingBox(layout.panels)!;
    const left = bbox.x * overview.scale + overview.panX;
    const top = bbox.y * overview.scale + overview.panY;
    const right = (bbox.x + bbox.width) * overview.scale + overview.panX;
    const bottom = (bbox.y + bbox.height) * overview.scale + overview.panY;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(800 + 1);
    expect(bottom).toBeLessThanOrEqual(600 + 1);
  });

  it("returns the identity viewport when no panel is open", () => {
    const layout = defaultBoardLayout("website");
    for (const panel of Object.values(layout.panels)) panel.open = false;
    expect(overviewViewport(layout.panels, { width: 800, height: 600 })).toEqual({
      panX: 0,
      panY: 0,
      scale: 1,
    });
  });
});
