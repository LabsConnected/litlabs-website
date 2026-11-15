import { describe, expect, it } from "vitest";
import {
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

  it("website default opens Preview, Code, Terminal, Files, Health (Checks), Inspector (Changes/Browser) and Deploy — chat is never a panel", () => {
    const layout = defaultBoardLayout("website");
    expect(layout.panels.preview.open).toBe(true);
    expect(layout.panels.code.open).toBe(true);
    expect(layout.panels.terminal.open).toBe(true);
    expect(layout.panels.files.open).toBe(true);
    expect(layout.panels.health.open).toBe(true);
    expect(layout.panels.inspector.open).toBe(true);
    expect(layout.panels.deploy.open).toBe(true);
    expect(layout.panels.world.open).toBe(false);
    expect(layout.panels.media.open).toBe(false);
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
      height: 160,
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
    // Media is closed in the website default; Health is open, so mark it
    // minimized to cover the minimized case.
    layout.panels.health = { ...layout.panels.health, minimized: true };
    const mediaBefore = layout.panels.media;
    const healthBefore = layout.panels.health;
    const tidied = tidyPanels(layout.panels, { width: 1200, height: 800 });
    expect(tidied.media).toBe(mediaBefore);
    expect(tidied.health).toBe(healthBefore);
    expect(layout.panels.preview.rect).toEqual({ x: 24, y: 24, width: 760, height: 520 });
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
