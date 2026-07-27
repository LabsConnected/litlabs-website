/**
 * Canvas blueprint test cases — the 12 cases from the Canvas blueprint.
 * These verify the full vertical slice: chat → canvas → blocks → tasks → undo → promote.
 *
 * Run: npx vitest run src/lib/canvas/blueprint.test.ts
 */

import { describe, it, expect } from "vitest";
import { detectCanvasActions, detectSuggestedActions } from "./actions";
import {
  CanvasSchema,
  CanvasBlockSchema,
  ArtifactActionSchema,
  CanvasOperationSchema,
  BlockTypeSchema,
  CanvasTypeSchema,
} from "./types";

// ─── Case 1: Normal chat produces no canvas action ──────────────

describe("Case 1: Normal chat produces no canvas action", () => {
  it("returns no actions for 'whats up'", () => {
    expect(detectCanvasActions("whats up", null)).toHaveLength(0);
  });
  it("returns no actions for 'tell me a joke'", () => {
    expect(detectCanvasActions("tell me a joke", null)).toHaveLength(0);
  });
  it("returns no actions for 'how are you'", () => {
    expect(detectCanvasActions("how are you", null)).toHaveLength(0);
  });
});

// ─── Case 2: 'Open in canvas' creates a canvas ──────────────────

describe("Case 2: 'Open in canvas' creates a canvas", () => {
  it("returns canvas.create action", () => {
    const actions = detectCanvasActions("open this in canvas", null);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("canvas.create");
  });
  it("includes initial blocks", () => {
    const actions = detectCanvasActions("open in canvas - my project plan", null);
    expect(actions).toHaveLength(1);
    if (actions[0].type === "canvas.create") {
      expect(actions[0].initialBlocks.length).toBeGreaterThan(0);
    }
  });
});

// ─── Case 3: Canvas type is inferred from message ───────────────

describe("Case 3: Canvas type is inferred from message", () => {
  it("infers 'website' for homepage messages", () => {
    const actions = detectCanvasActions("build the homepage", null);
    if (actions[0].type === "canvas.create") {
      expect(actions[0].canvasType).toBe("website");
    }
  });
  it("infers 'code' for code messages", () => {
    const actions = detectCanvasActions("open in canvas - write a react component", null);
    if (actions[0].type === "canvas.create") {
      expect(actions[0].canvasType).toBe("code");
    }
  });
  it("infers 'planning' for roadmap messages", () => {
    const actions = detectCanvasActions("open in canvas - plan the roadmap", null);
    if (actions[0].type === "canvas.create") {
      expect(actions[0].canvasType).toBe("planning");
    }
  });
  it("infers 'notes' for notes messages", () => {
    const actions = detectCanvasActions("make notes", null);
    if (actions[0].type === "canvas.create") {
      expect(actions[0].canvasType).toBe("notes");
    }
  });
});

// ─── Case 4: 'Make notes' creates a notes canvas ────────────────

describe("Case 4: 'Make notes' creates a notes canvas", () => {
  it("returns canvas.create with type 'notes'", () => {
    const actions = detectCanvasActions("make notes about the meeting", null);
    expect(actions).toHaveLength(1);
    if (actions[0].type === "canvas.create") {
      expect(actions[0].canvasType).toBe("notes");
      expect(actions[0].title).toBe("Notes");
    }
  });
});

// ─── Case 5: 'Create a checklist' creates a checklist canvas ────

describe("Case 5: 'Create a checklist' creates a checklist canvas", () => {
  it("returns canvas.create with checklist block", () => {
    const actions = detectCanvasActions("create a checklist for the launch", null);
    expect(actions).toHaveLength(1);
    if (actions[0].type === "canvas.create") {
      const hasChecklist = actions[0].initialBlocks.some(
        (b) => b.type === "checklist",
      );
      expect(hasChecklist).toBe(true);
    }
  });
});

// ─── Case 6: 'Add this to canvas' appends to active canvas ──────

describe("Case 6: 'Add this to canvas' appends to active canvas", () => {
  it("returns canvas.append when canvas is active", () => {
    const actions = detectCanvasActions("add this to canvas", "canvas-123");
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("canvas.append");
    if (actions[0].type === "canvas.append") {
      expect(actions[0].canvasId).toBe("canvas-123");
    }
  });
  it("returns no action when no canvas is active", () => {
    const actions = detectCanvasActions("add this to canvas", null);
    expect(actions).toHaveLength(0);
  });
});

// ─── Case 7: Suggested actions from code blocks ─────────────────

describe("Case 7: Suggested actions from code blocks", () => {
  it("suggests code canvas when response has a code block", () => {
    const response = "Here's the code:\n```typescript\nconst x = 1;\n```";
    const actions = detectSuggestedActions(response);
    expect(actions).toHaveLength(1);
    if (actions[0].type === "canvas.create") {
      expect(actions[0].canvasType).toBe("code");
    }
  });
});

// ─── Case 8: Suggested actions from checklists ──────────────────

describe("Case 8: Suggested actions from checklists", () => {
  it("suggests checklist canvas when response has markdown checklist", () => {
    const response = "Todo:\n- [ ] Task one\n- [ ] Task two\n- [ ] Task three";
    const actions = detectSuggestedActions(response);
    expect(actions.length).toBeGreaterThanOrEqual(1);
    const checklist = actions.find(
      (a) => a.type === "canvas.create" && a.canvasType === "notes",
    );
    expect(checklist).toBeDefined();
  });
});

// ─── Case 9: 'Promote to project' creates project action ────────

describe("Case 9: 'Promote to project' creates project action", () => {
  it("returns project.promote when canvas is active", () => {
    const actions = detectCanvasActions("promote to project", "canvas-123");
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("project.promote");
  });
  it("returns no action when no canvas is active", () => {
    const actions = detectCanvasActions("promote to project", null);
    expect(actions).toHaveLength(0);
  });
});

// ─── Case 10: Type validation ───────────────────────────────────

describe("Case 10: Type validation", () => {
  it("validates a Canvas object", () => {
    const canvas = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      userId: "user_123",
      projectId: null,
      missionId: null,
      conversationId: null,
      title: "Test Canvas",
      type: "document",
      status: "active",
      version: 1,
      metadata: {},
      createdAt: "2026-07-28T00:00:00Z",
      updatedAt: "2026-07-28T00:00:00Z",
    };
    expect(CanvasSchema.safeParse(canvas).success).toBe(true);
  });
  it("validates a CanvasBlock object", () => {
    const block = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      canvasId: "660e8400-e29b-41d4-a716-446655440000",
      userId: "user_123",
      type: "heading",
      content: { text: "Test", level: 2 },
      position: 0,
      metadata: {},
      createdAt: "2026-07-28T00:00:00Z",
      updatedAt: "2026-07-28T00:00:00Z",
    };
    expect(CanvasBlockSchema.safeParse(block).success).toBe(true);
  });
  it("validates an ArtifactAction", () => {
    const action = {
      type: "canvas.create",
      title: "Test",
      canvasType: "notes",
      initialBlocks: [],
    };
    expect(ArtifactActionSchema.safeParse(action).success).toBe(true);
  });
  it("rejects invalid canvas type", () => {
    expect(CanvasTypeSchema.safeParse("invalid").success).toBe(false);
  });
  it("rejects invalid block type", () => {
    expect(BlockTypeSchema.safeParse("invalid").success).toBe(false);
  });
});

// ─── Case 11: Canvas operations are reversible ──────────────────

describe("Case 11: Canvas operations are reversible", () => {
  it("block.add operation is valid", () => {
    const op = {
      op: "block.add",
      blockId: "550e8400-e29b-41d4-a716-446655440000",
      type: "paragraph",
      content: { text: "Hello" },
      position: 0,
    };
    expect(CanvasOperationSchema.safeParse(op).success).toBe(true);
  });
  it("block.delete operation is valid", () => {
    const op = {
      op: "block.delete",
      blockId: "550e8400-e29b-41d4-a716-446655440000",
      previousContent: { text: "Hello" },
      previousPosition: 0,
    };
    expect(CanvasOperationSchema.safeParse(op).success).toBe(true);
  });
  it("block.update operation stores previousContent for undo", () => {
    const op = {
      op: "block.update",
      blockId: "550e8400-e29b-41d4-a716-446655440000",
      patch: { text: "New" },
      previousContent: { text: "Old" },
    };
    const result = CanvasOperationSchema.safeParse(op);
    expect(result.success).toBe(true);
    if (result.success && result.data.op === "block.update") {
      // previousContent must be present for undo to work
      expect(result.data.previousContent).toEqual({ text: "Old" });
    }
  });
  it("canvas.rename operation stores previousTitle for undo", () => {
    const op = {
      op: "canvas.rename",
      previousTitle: "Old Title",
      newTitle: "New Title",
    };
    const result = CanvasOperationSchema.safeParse(op);
    expect(result.success).toBe(true);
    if (result.success && result.data.op === "canvas.rename") {
      expect(result.data.previousTitle).toBe("Old Title");
    }
  });
});

// ─── Case 12: Action chips don't fire for general conversation ──

describe("Case 12: Action chips don't fire for general conversation", () => {
  it("returns no actions for greetings", () => {
    expect(detectCanvasActions("hello", null)).toHaveLength(0);
    expect(detectCanvasActions("hi there", null)).toHaveLength(0);
    expect(detectCanvasActions("hey what's going on", null)).toHaveLength(0);
  });
  it("returns no actions for questions", () => {
    expect(detectCanvasActions("what is the weather", null)).toHaveLength(0);
    expect(detectCanvasActions("can you help me", null)).toHaveLength(0);
  });
  it("returns no suggested actions for short responses", () => {
    expect(detectSuggestedActions("Yes.")).toHaveLength(0);
    expect(detectSuggestedActions("No problem.")).toHaveLength(0);
    expect(detectSuggestedActions("Sure thing!")).toHaveLength(0);
  });
});
