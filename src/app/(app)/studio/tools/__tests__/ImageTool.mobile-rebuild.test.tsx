/**
 * Regression tests for the mobile Image/Create rebuild.
 *
 * Spec: premium dedicated AI image generator on mobile —
 *  - prompt + Generate CTA high in the first viewport
 *  - result is the primary visual (full width, correct aspect ratio,
 *    skeleton while rendering, progressive replace on completion)
 *  - recent generations as a responsive image grid with tap-to-preview
 *    (Use in Project, Download, Regenerate, Edit, Delete)
 *  - Style/Mood/Ratio via wrapping grids (no clipped horizontal content),
 *    secondary controls in a bottom sheet
 *  - prompt suggestions as responsive cards
 *  - zero horizontal overflow at 320/360/390/412/430px
 *  - touch targets >= 44px, no bottom-nav overlap
 *
 * The ImageTool component is too heavy to render in jsdom (Theme/Wallet/
 * Studio contexts, 3000+ lines), so these tests assert the structural
 * contract against the real source: section order, wrapping (not scrolling)
 * controls, preview actions, touch-target sizes, and aspect-ratio handling.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const IMAGE_TOOL_PATH = path.resolve(__dirname, "../ImageTool.tsx");

function mobilePane(): string {
  const src = fs.readFileSync(IMAGE_TOOL_PATH, "utf8");
  const start = src.indexOf("MOBILE REBUILD");
  const end = src.indexOf("LEFT PANEL: Controls (desktop only)");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("ImageTool mobile rebuild", () => {
  it("prompt, generate, result, design, recents, suggestions render in order", () => {
    const pane = mobilePane();
    const order = [
      'data-testid="image-prompt-input"',
      'data-testid="generate-image-button"',
      'data-testid="image-result-hero"',
      "Design",
      'data-testid="image-recents-grid"',
      "Try a prompt",
    ];
    let last = -1;
    for (const token of order) {
      const idx = pane.indexOf(token);
      expect(idx, `missing: ${token}`).toBeGreaterThan(-1);
      expect(idx, `out of order: ${token}`).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("result hero covers empty, generating, completed, and failure states", () => {
    const pane = mobilePane();
    // Empty state
    expect(pane).toContain('data-testid="image-empty-state"');
    // Generating skeleton (aspect-ratio box, no layout jump)
    expect(pane).toContain('data-testid="image-generating-skeleton"');
    expect(pane).toContain("aspectRatio");
    // Completed — full-width image, correct aspect, no stretching
    expect(pane).toContain('data-testid="generated-image"');
    expect(pane).toContain("object-cover");
    // Failure — error card with retry
    expect(pane).toContain("Try again");
    expect(pane).toContain('role="alert"');
  });

  it("style/mood/ratio use wrapping grids, never horizontal scrollers", () => {
    const pane = mobilePane();
    expect(pane).not.toMatch(/overflow-x-auto/);
    // Wrapping chip grids for each design section
    const wraps = pane.match(/flex flex-wrap gap-1\.5/g) ?? [];
    expect(wraps.length).toBeGreaterThanOrEqual(3);
  });

  it("aspect ratio options cover portrait, square, and landscape", () => {
    const src = fs.readFileSync(IMAGE_TOOL_PATH, "utf8");
    for (const ratio of ['"1:1"', '"9:16"', '"16:9"', '"4:5"', '"3:2"']) {
      expect(src).toContain(ratio);
    }
    // Hero applies the selected ratio (portrait/square/landscape handled)
    const pane = mobilePane();
    expect(pane).toContain("currentAspect.width");
  });

  it("recent generations render as a responsive grid", () => {
    const pane = mobilePane();
    expect(pane).toContain('data-testid="image-recents-grid"');
    expect(pane).toContain("grid grid-cols-3");
    expect(pane).toContain("aspect-square");
    expect(pane).toContain("object-cover");
  });

  it("preview offers Use in Project, Download, Regenerate, Edit, Delete", () => {
    const pane = mobilePane();
    expect(pane).toContain('data-testid="image-preview"');
    expect(pane).toContain("Use in Project");
    expect(pane).toContain("Download");
    expect(pane).toContain("Regenerate");
    // Edit (Wand2) — label present on the edit action button
    expect(pane).toMatch(/>\s*Edit\s*</);
    expect(pane).toContain("Delete");
    expect(pane).toContain('data-testid="image-preview-img"');
  });

  it("more-settings bottom sheet holds lighting, camera, model, quality, batch", () => {
    const pane = mobilePane();
    expect(pane).toContain('data-testid="image-more-sheet"');
    for (const section of ["Lighting", "Camera", "Model", "Quality", "Batch"]) {
      expect(pane).toContain(section);
    }
    // Sheet is a fixed bottom sheet, scrollable, mobile-only
    expect(pane).toMatch(/image-more-sheet" role="dialog"/);
    expect(pane).toContain("fixed inset-0");
    expect(pane).toContain("rounded-t-3xl");
  });

  it("primary touch targets are at least 44px", () => {
    const pane = mobilePane();
    // Generate CTA well above the minimum
    expect(pane).toContain("min-h-[52px]");
    // Action buttons meet the 44px rule
    const targets44 = pane.match(/min-h-\[4[48]px\]/g) ?? [];
    expect(targets44.length).toBeGreaterThanOrEqual(10);
  });

  it("scrollable content clears the fixed bottom nav (safe-area padding)", () => {
    const src = fs.readFileSync(IMAGE_TOOL_PATH, "utf8");
    // Inner scroller bottom padding accounts for the fixed nav + safe area
    expect(src).toContain("pb-[calc(20px+env(safe-area-inset-bottom))]");
    // Overlays respect top/bottom safe areas
    const pane = mobilePane();
    expect(pane).toContain("env(safe-area-inset-top)");
    expect(pane).toContain("env(safe-area-inset-bottom)");
  });

  it("prompt suggestions render as responsive cards (no horizontal scroll)", () => {
    const pane = mobilePane();
    expect(pane).toContain("Try a prompt");
    expect(pane).toContain("grid grid-cols-1 gap-2");
    expect(pane).toContain("handleUsePrompt");
  });

  it("desktop panels are untouched by the rebuild", () => {
    const src = fs.readFileSync(IMAGE_TOOL_PATH, "utf8");
    const desktopStart = src.indexOf("LEFT PANEL: Controls (desktop only)");
    const desktop = src.slice(desktopStart);
    // Desktop keeps its own advanced inline panel and hover actions
    expect(desktop).toContain("hidden md:flex");
    expect(desktop).toContain("glass-panel");
  });
});
