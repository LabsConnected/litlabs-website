import { describe, expect, it } from "vitest";
import {
  clampPanelsToArea,
  clampRect,
  defaultBoardLayout,
  overviewViewport,
  panelsBoundingBox,
  tidyPanels,
  visiblePanels,
} from "./board-layout";
import { BOARD_PANEL_IDS } from "./board-types";

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
    expect(layout.panels.inspector.open).toBe(false);
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
