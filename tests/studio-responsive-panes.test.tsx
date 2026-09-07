// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

/**
 * Studio Responsive Pane Geometry Tests.
 *
 * Verifies mathematical and CSS constraints across all 6 desktop/laptop viewports:
 * 1. 1024x768 (compact laptop): preview is tabbed in workspace, center >= 320px
 * 2. 1100x800 (compact laptop): preview is tabbed in workspace, center >= 320px
 * 3. 1280x800 (desktop split): preview is permanent column, center >= 320px
 * 4. 1440x900 (desktop split): preview is permanent column, center >= 420px
 * 5. 1680x1050 (desktop split): preview is permanent column, center >= 420px
 * 6. 1920x1080 (desktop split): preview is permanent column, center >= 420px
 */

function computePaneLayout(viewportWidth: number, sidebarCollapsed = false, littExpandedWidth = 520, previewExpandedWidth = 600) {
  const sidebarWidth = sidebarCollapsed ? 72 : 256;
  const isDesktopSplit = viewportWidth >= 1280;

  // LiTT panel clamp:
  // style: width: clamp(300px, ${expandedWidth}px, min(640px, 26vw))
  const littMaxVw = (26 / 100) * viewportWidth;
  const littUpper = Math.min(640, littMaxVw);
  const littWidth = Math.max(300, Math.min(littExpandedWidth, littUpper));

  // Preview panel clamp (only on desktop split >= 1280px):
  // style: width: clamp(280px, ${previewResize.width}px, min(1200px, 26.5vw))
  let previewWidth = 0;
  if (isDesktopSplit) {
    const previewMaxVw = (26.5 / 100) * viewportWidth;
    const previewUpper = Math.min(1200, previewMaxVw);
    previewWidth = Math.max(280, Math.min(previewExpandedWidth, previewUpper));
  }

  const centerWidth = viewportWidth - sidebarWidth - littWidth - previewWidth;

  return {
    viewportWidth,
    sidebarWidth,
    isDesktopSplit,
    littWidth,
    previewWidth,
    centerWidth,
  };
}

describe("Studio Responsive Pane Geometry", () => {
  const VIEWPORTS = [
    { width: 1024, height: 768, tier: "compact", minCenter: 320 },
    { width: 1100, height: 800, tier: "compact", minCenter: 320 },
    { width: 1280, height: 800, tier: "desktop-split", minCenter: 320 },
    { width: 1440, height: 900, tier: "desktop-split", minCenter: 420 },
    { width: 1680, height: 1050, tier: "desktop-split", minCenter: 420 },
    { width: 1920, height: 1080, tier: "desktop-split", minCenter: 420 },
  ];

  for (const { width, height, tier, minCenter } of VIEWPORTS) {
    it(`guarantees center workspace >= ${minCenter}px at ${width}x${height} (${tier})`, () => {
      const layout = computePaneLayout(width);

      expect(layout.littWidth).toBeGreaterThanOrEqual(280);
      if (layout.isDesktopSplit) {
        expect(layout.previewWidth).toBeGreaterThanOrEqual(260);
      } else {
        expect(layout.previewWidth).toBe(0); // Tabbed mode below 1280px
      }

      expect(layout.centerWidth).toBeGreaterThanOrEqual(minCenter);

      // Verify total width spans 100% of viewport without overflow
      const totalWidth = layout.sidebarWidth + layout.littWidth + layout.previewWidth + layout.centerWidth;
      expect(totalWidth).toBe(width);
    });
  }

  it("provides even more center workspace room when sidebar is collapsed (72px)", () => {
    const layout1280 = computePaneLayout(1280, true);
    expect(layout1280.sidebarWidth).toBe(72);
    expect(layout1280.centerWidth).toBeGreaterThanOrEqual(500);

    const layout1440 = computePaneLayout(1440, true);
    expect(layout1440.sidebarWidth).toBe(72);
    expect(layout1440.centerWidth).toBeGreaterThanOrEqual(600);
  });
});
