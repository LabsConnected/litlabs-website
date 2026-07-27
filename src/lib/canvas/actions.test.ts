/**
 * Unit tests for canvas action detection.
 * Run: npx vitest run src/lib/canvas/actions.test.ts
 */

import { describe, it, expect } from "vitest";
import { detectCanvasActions, detectSuggestedActions } from "./actions";

describe("detectCanvasActions", () => {
  it("detects 'open in canvas' as explicit create", () => {
    const actions = detectCanvasActions("open this in canvas", null);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("canvas.create");
  });

  it("detects 'make notes' as explicit create with notes type", () => {
    const actions = detectCanvasActions("make notes about this", null);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("canvas.create");
    if (actions[0].type === "canvas.create") {
      expect(actions[0].canvasType).toBe("notes");
    }
  });

  it("detects 'create a checklist' as explicit create", () => {
    const actions = detectCanvasActions("create a checklist for the launch", null);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("canvas.create");
  });

  it("detects 'build the homepage' as website canvas", () => {
    const actions = detectCanvasActions("build the homepage for my site", null);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("canvas.create");
    if (actions[0].type === "canvas.create") {
      expect(actions[0].canvasType).toBe("website");
    }
  });

  it("detects 'add this to canvas' as append when canvas is active", () => {
    const actions = detectCanvasActions("add this to canvas", "canvas-123");
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("canvas.append");
    if (actions[0].type === "canvas.append") {
      expect(actions[0].canvasId).toBe("canvas-123");
    }
  });

  it("returns empty for 'add this to canvas' when no active canvas", () => {
    const actions = detectCanvasActions("add this to canvas", null);
    expect(actions).toHaveLength(0);
  });

  it("detects 'promote to project' as project.promote", () => {
    const actions = detectCanvasActions("promote to project", "canvas-123");
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("project.promote");
  });

  it("returns empty for general conversation", () => {
    expect(detectCanvasActions("whats up", null)).toHaveLength(0);
    expect(detectCanvasActions("tell me a joke", null)).toHaveLength(0);
    expect(detectCanvasActions("how are you", null)).toHaveLength(0);
  });

  it("infers code canvas type for code-related messages", () => {
    const actions = detectCanvasActions("open in canvas - I need to write a react component", null);
    expect(actions).toHaveLength(1);
    if (actions[0].type === "canvas.create") {
      expect(actions[0].canvasType).toBe("code");
    }
  });

  it("infers planning canvas type for plan-related messages", () => {
    const actions = detectCanvasActions("open in canvas - let's plan the roadmap", null);
    expect(actions).toHaveLength(1);
    if (actions[0].type === "canvas.create") {
      expect(actions[0].canvasType).toBe("planning");
    }
  });
});

describe("detectSuggestedActions", () => {
  it("suggests code canvas when response contains a code block", () => {
    const response = "Here's the code:\n```typescript\nconst x = 1;\n```";
    const actions = detectSuggestedActions(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("canvas.create");
    if (actions[0].type === "canvas.create") {
      expect(actions[0].canvasType).toBe("code");
    }
  });

  it("suggests checklist canvas when response contains markdown checklist", () => {
    const response = "Here's what to do:\n- [ ] Task one\n- [ ] Task two\n- [ ] Task three";
    const actions = detectSuggestedActions(response);
    expect(actions.length).toBeGreaterThanOrEqual(1);
    const checklist = actions.find((a) => a.type === "canvas.create" && a.canvasType === "notes");
    expect(checklist).toBeDefined();
  });

  it("suggests notes canvas for long structured responses", () => {
    const longResponse = "This is a detailed answer. ".repeat(50);
    const actions = detectSuggestedActions(longResponse);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("canvas.create");
  });

  it("returns empty for short responses", () => {
    expect(detectSuggestedActions("Yes.")).toHaveLength(0);
    expect(detectSuggestedActions("No problem.")).toHaveLength(0);
  });
});
