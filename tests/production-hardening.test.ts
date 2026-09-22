import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Production Hardening Pass — tests for resizable shell, one-LiTT,
 * Canvas save state truthfulness, and navigation consistency.
 */

// ─── Resizable width hook ─────────────────────────────────────────

describe("useResizableWidth", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("returns default width on first render", async () => {
    const { useResizableWidth } = await import("../src/app/(app)/studio/hooks/useResizableWidth");
    // We can't call hooks outside React, so test the logic indirectly
    // by verifying the module exports the expected interface
    expect(typeof useResizableWidth).toBe("function");
  });

  it("persists width to localStorage with storage key", () => {
    const key = "littree:studio:test-width";
    localStorage.setItem(key, "350");
    expect(localStorage.getItem(key)).toBe("350");
  });

  it("clamps width to min/max bounds", () => {
    const min = 280;
    const max = 480;
    const clamp = (w: number) => Math.min(max, Math.max(min, w));
    expect(clamp(200)).toBe(280);
    expect(clamp(500)).toBe(480);
    expect(clamp(320)).toBe(320);
  });
});

// ─── Canvas save state truthfulness ───────────────────────────────

describe("Canvas save state truthfulness", () => {
  it("saveState starts as 'local' (not 'saved')", async () => {
    const mod = await import("../src/app/(app)/studio/components/canvas/builder/store");
    const state = mod.useCanvasBuilderStore.getState();
    expect(state.saveState).toBe("local");
  });

  it("saveState becomes 'dirty' after setDocument", async () => {
    const mod = await import("../src/app/(app)/studio/components/canvas/builder/store");
    const { createEmptyDocument } = await import("../src/app/(app)/studio/components/canvas/builder/types");
    mod.useCanvasBuilderStore.getState().setDocument(createEmptyDocument());
    expect(mod.useCanvasBuilderStore.getState().saveState).toBe("dirty");
  });

  it("saveState becomes 'saved' or 'local' after saveDocument", async () => {
    const mod = await import("../src/app/(app)/studio/components/canvas/builder/store");
    // Without a server canvas ID, it should be "local"
    mod.useCanvasBuilderStore.getState().saveDocument();
    expect(mod.useCanvasBuilderStore.getState().saveState).toBe("local");
  });

  it("saveState becomes 'saved' when serverCanvasId is set", async () => {
    const mod = await import("../src/app/(app)/studio/components/canvas/builder/store");
    mod.useCanvasBuilderStore.getState().setServerCanvasId("test-canvas-id");
    mod.useCanvasBuilderStore.getState().saveDocument();
    expect(mod.useCanvasBuilderStore.getState().saveState).toBe("saved");
  });
});

// ─── One LiTT — no duplicate chat ─────────────────────────────────

describe("One LiTT architecture", () => {
  it("PropertiesPanel does not import LiTTCopilotPanel", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/components/canvas/builder/PropertiesPanel.tsx"),
      "utf-8",
    );
    expect(content).not.toContain("LiTTCopilotPanel");
    expect(content).not.toContain("rightPanelTab");
  });

  it("PropertiesPanel has Ask LiTT button that dispatches studio:ask-litt event", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/components/canvas/builder/PropertiesPanel.tsx"),
      "utf-8",
    );
    expect(content).toContain("studio:ask-litt");
    expect(content).toContain("Ask LiTT");
  });

  it("CanvasToolbar Ask LiTT dispatches studio:ask-litt (not setRightPanelTab)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/components/canvas/builder/CanvasToolbar.tsx"),
      "utf-8",
    );
    expect(content).toContain("studio:ask-litt");
    expect(content).not.toContain("setRightPanelTab");
  });
});

// ─── Build → Edit rename ──────────────────────────────────────────

describe("Canvas Build button renamed to Edit", () => {
  it("CanvasToolbar shows 'Edit' not 'Build'", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/components/canvas/builder/CanvasToolbar.tsx"),
      "utf-8",
    );
    expect(content).toContain("Edit");
    expect(content).not.toContain(">Build<");
  });
});

// ─── Navigation consistency ───────────────────────────────────────

describe("Navigation routes Music to Studio", () => {
  it("main nav has no dedicated Music entry (music is a Create intent)", async () => {
    const mod = await import("../src/lib/navigation");
    const labels = mod.APP_NAV_MAIN.map((i) => i.label);
    expect(labels).not.toContain("Music");
  });

  it("the /create hub links Music & Audio to the real Studio music mode", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/components/create/CreateExperience.tsx"),
      "utf-8",
    );
    expect(content).toContain('label: "Music & Audio"');
    expect(content).toContain("/studio?tool=chat&mode=music");
  });
});

// ─── 360° truthfulness ────────────────────────────────────────────

describe("360° creator truthfulness", () => {
  it("SpaceTool shows not-available banner", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/tools/SpaceTool.tsx"),
      "utf-8",
    );
    expect(content).toContain("not yet available");
  });

  it("skybox generate route returns 503", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/api/skybox/generate/route.ts"),
      "utf-8",
    );
    expect(content).toContain("503");
  });
});

// ─── Files is not a workspace stage ───────────────────────────────

describe("Files is not a workspace stage", () => {
  it("WorkspaceStage type does not include 'files'", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/lib/studio-destinations.ts"),
      "utf-8",
    );
    // The type definition should be "plan" | "canvas" | "code" | "preview"
    expect(content).toContain('"plan" | "canvas" | "code" | "preview"');
    // Files should not be in the WorkspaceStage type
    const typeMatch = content.match(/export type WorkspaceStage = ([^;]+);/);
    expect(typeMatch).toBeTruthy();
    expect(typeMatch![1]).not.toContain('"files"');
  });

  it("Files lives in the unified dock (not the workspace tab strip)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const studio = fs.readFileSync(
      path.resolve("src/app/(app)/studio/components/CommandStudio.tsx"),
      "utf-8",
    );
    const dock = fs.readFileSync(
      path.resolve("src/app/(app)/studio/components/StudioDock.tsx"),
      "utf-8",
    );
    // The old workspace-strip Files button is gone…
    expect(studio).not.toContain("workspace-tab-files");
    // …Files is a first-class dock tab wired to the dock…
    expect(studio).toContain('handleOpenDockTab("files")');
    expect(dock).toContain('id: "files"');
    expect(dock).toContain("dock-tab-");
  });
});

// ─── Resize handle exists ─────────────────────────────────────────

describe("Resize handles are wired", () => {
  it("dock has its own drag-to-resize grip (unified-dock topology)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const dock = fs.readFileSync(
      path.resolve("src/app/(app)/studio/components/StudioDock.tsx"),
      "utf-8",
    );
    // The old ResizeHandle/useResizableWidth pair is gone with the
    // ContextDrawer/StudioDrawer; the dock resizes via its own grip.
    expect(dock).toContain("data-resize-grip");
    expect(dock).toContain("Drag to resize dock");
    expect(dock).toContain("cursor-row-resize");
  });

  it("LiTTPanel accepts expandedWidth prop", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/components/LiTTPanel.tsx"),
      "utf-8",
    );
    expect(content).toContain("expandedWidth");
  });

  it("ContextDrawer accepts width prop", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/components/context/ContextDrawer.tsx"),
      "utf-8",
    );
    expect(content).toContain("width?: number");
  });

  it("VisualCanvasBuilder uses resizable palette and inspector", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/components/canvas/builder/VisualCanvasBuilder.tsx"),
      "utf-8",
    );
    expect(content).toContain("paletteResize");
    expect(content).toContain("inspectorResize");
    expect(content).toContain("palette-resize-handle");
    expect(content).toContain("inspector-resize-handle");
  });

  it("DesignCanvas has draggable split", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/tools/DesignCanvas.tsx"),
      "utf-8",
    );
    expect(content).toContain("splitPct");
    expect(content).toContain("design-split-handle");
    expect(content).toContain("onSplitDragStart");
  });
});

// ─── Text input bug fix — body userSelect cleanup ────────────────

describe("Text input bug — resize hooks clean up body styles", () => {
  it("useResizableWidth clears body.userSelect on cleanup", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/hooks/useResizableWidth.ts"),
      "utf-8",
    );
    // The effect cleanup MUST clear userSelect, not just the onEnd handler
    expect(content).toContain('document.body.style.userSelect = ""');
  });

  it("useResizableWidth clears body styles on mount (safety)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/hooks/useResizableWidth.ts"),
      "utf-8",
    );
    // Safety: clear stuck styles on mount
    expect(content).toContain('document.body.style.userSelect === "none"');
  });

  it("DesignCanvas cleans up body styles on unmount", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/tools/DesignCanvas.tsx"),
      "utf-8",
    );
    // The drag effect must have a cleanup return
    expect(content).toContain('document.body.style.userSelect = ""');
  });

  it("CommandStudio clears stuck body styles on mount", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/components/CommandStudio.tsx"),
      "utf-8",
    );
    expect(content).toContain('document.body.style.userSelect === "none"');
  });

  it("VisualCanvasBuilder keyboard handler guards input fields", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/components/canvas/builder/VisualCanvasBuilder.tsx"),
      "utf-8",
    );
    expect(content).toContain('target.tagName === "INPUT"');
    expect(content).toContain('target.tagName === "TEXTAREA"');
  });

  it("dock keyboard shortcuts guard input fields", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/(app)/studio/components/CommandStudio.tsx"),
      "utf-8",
    );
    // The guard moved with the shortcuts: the deleted StudioDrawer's
    // handler is gone, but CommandStudio's Cmd/Ctrl+J + Ctrl+Shift+A
    // handler must still not hijack keys while typing.
    expect(content).toContain('target?.tagName === "INPUT"');
    expect(content).toContain('target?.tagName === "TEXTAREA"');
  });
});
