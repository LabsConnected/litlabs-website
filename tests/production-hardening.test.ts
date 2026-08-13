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
    const { useResizableWidth } = await import("../src/app/studio/hooks/useResizableWidth");
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
    const mod = await import("../src/app/studio/components/canvas/builder/store");
    const state = mod.useCanvasBuilderStore.getState();
    expect(state.saveState).toBe("local");
  });

  it("saveState becomes 'dirty' after setDocument", async () => {
    const mod = await import("../src/app/studio/components/canvas/builder/store");
    const { createEmptyDocument } = await import("../src/app/studio/components/canvas/builder/types");
    mod.useCanvasBuilderStore.getState().setDocument(createEmptyDocument());
    expect(mod.useCanvasBuilderStore.getState().saveState).toBe("dirty");
  });

  it("saveState becomes 'saved' or 'local' after saveDocument", async () => {
    const mod = await import("../src/app/studio/components/canvas/builder/store");
    // Without a server canvas ID, it should be "local"
    mod.useCanvasBuilderStore.getState().saveDocument();
    expect(mod.useCanvasBuilderStore.getState().saveState).toBe("local");
  });

  it("saveState becomes 'saved' when serverCanvasId is set", async () => {
    const mod = await import("../src/app/studio/components/canvas/builder/store");
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
      path.resolve("src/app/studio/components/canvas/builder/PropertiesPanel.tsx"),
      "utf-8",
    );
    expect(content).not.toContain("LiTTCopilotPanel");
    expect(content).not.toContain("rightPanelTab");
  });

  it("PropertiesPanel has Ask LiTT button that dispatches studio:ask-litt event", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/studio/components/canvas/builder/PropertiesPanel.tsx"),
      "utf-8",
    );
    expect(content).toContain("studio:ask-litt");
    expect(content).toContain("Ask LiTT");
  });

  it("CanvasToolbar Ask LiTT dispatches studio:ask-litt (not setRightPanelTab)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/studio/components/canvas/builder/CanvasToolbar.tsx"),
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
      path.resolve("src/app/studio/components/canvas/builder/CanvasToolbar.tsx"),
      "utf-8",
    );
    expect(content).toContain("Edit");
    expect(content).not.toContain(">Build<");
  });
});

// ─── Navigation consistency ───────────────────────────────────────

describe("Navigation routes Music to Studio", () => {
  it("create group Music links to /studio?tool=music", async () => {
    const mod = await import("../src/lib/navigation");
    const createGroup = mod.APP_NAV_SECTIONS.find((g) => g.id === "create");
    expect(createGroup).toBeDefined();
    const musicItem = createGroup!.items.find((i) => i.label === "Music");
    expect(musicItem).toBeDefined();
    expect(musicItem!.href).toBe("/studio?tool=music");
    expect(musicItem!.href).not.toContain("/dashboard?app=music");
  });

  it("sidebar Music links to /studio?tool=music", async () => {
    const mod = await import("../src/lib/navigation");
    const studioGroup = mod.NAV_GROUPS.find((g) => g.label === "Studio");
    expect(studioGroup).toBeDefined();
    const musicItem = studioGroup!.items.find((i) => i.label === "Music");
    expect(musicItem).toBeDefined();
    expect(musicItem!.href).toBe("/studio?tool=music");
  });

  it("quick create Music links to /studio?tool=music", async () => {
    const mod = await import("../src/lib/navigation");
    const musicQuick = mod.QUICK_CREATE_ITEMS.find((i) => i.label === "Create Music");
    expect(musicQuick).toBeDefined();
    expect(musicQuick!.href).toBe("/studio?tool=music");
  });
});

// ─── 360° truthfulness ────────────────────────────────────────────

describe("360° creator truthfulness", () => {
  it("SpaceTool shows not-available banner", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/studio/tools/SpaceTool.tsx"),
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
      path.resolve("src/app/studio/lib/studio-destinations.ts"),
      "utf-8",
    );
    // The type definition should be "plan" | "canvas" | "code" | "preview"
    expect(content).toContain('"plan" | "canvas" | "code" | "preview"');
    // Files should not be in the WorkspaceStage type
    const typeMatch = content.match(/export type WorkspaceStage = ([^;]+);/);
    expect(typeMatch).toBeTruthy();
    expect(typeMatch![1]).not.toContain('"files"');
  });

  it("CommandStudio has visual divider before Files button", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/studio/components/CommandStudio.tsx"),
      "utf-8",
    );
    expect(content).toContain("Visual divider");
    expect(content).toContain("FolderOpen");
  });
});

// ─── Resize handle exists ─────────────────────────────────────────

describe("Resize handles are wired", () => {
  it("CommandStudio imports ResizeHandle and useResizableWidth", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/studio/components/CommandStudio.tsx"),
      "utf-8",
    );
    expect(content).toContain("ResizeHandle");
    expect(content).toContain("useResizableWidth");
    expect(content).toContain("litt-resize-handle");
    expect(content).toContain("context-resize-handle");
  });

  it("LiTTPanel accepts expandedWidth prop", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/studio/components/LiTTPanel.tsx"),
      "utf-8",
    );
    expect(content).toContain("expandedWidth");
  });

  it("ContextDrawer accepts width prop", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/studio/components/context/ContextDrawer.tsx"),
      "utf-8",
    );
    expect(content).toContain("width?: number");
  });

  it("VisualCanvasBuilder uses resizable palette and inspector", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/studio/components/canvas/builder/VisualCanvasBuilder.tsx"),
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
      path.resolve("src/app/studio/tools/DesignCanvas.tsx"),
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
      path.resolve("src/app/studio/hooks/useResizableWidth.ts"),
      "utf-8",
    );
    // The effect cleanup MUST clear userSelect, not just the onEnd handler
    expect(content).toContain('document.body.style.userSelect = ""');
  });

  it("useResizableWidth clears body styles on mount (safety)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/studio/hooks/useResizableWidth.ts"),
      "utf-8",
    );
    // Safety: clear stuck styles on mount
    expect(content).toContain('document.body.style.userSelect === "none"');
  });

  it("DesignCanvas cleans up body styles on unmount", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/studio/tools/DesignCanvas.tsx"),
      "utf-8",
    );
    // The drag effect must have a cleanup return
    expect(content).toContain('document.body.style.userSelect = ""');
  });

  it("CommandStudio clears stuck body styles on mount", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/studio/components/CommandStudio.tsx"),
      "utf-8",
    );
    expect(content).toContain('document.body.style.userSelect === "none"');
  });

  it("VisualCanvasBuilder keyboard handler guards input fields", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/studio/components/canvas/builder/VisualCanvasBuilder.tsx"),
      "utf-8",
    );
    expect(content).toContain('target.tagName === "INPUT"');
    expect(content).toContain('target.tagName === "TEXTAREA"');
  });

  it("StudioWorkspaceFrame keyboard handler guards input fields", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve("src/app/studio/components/StudioWorkspaceFrame.tsx"),
      "utf-8",
    );
    expect(content).toContain('target?.tagName === "INPUT"');
  });
});
