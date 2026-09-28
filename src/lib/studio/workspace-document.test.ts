import { describe, expect, it } from "vitest";
import {
  applyWorkspaceAction,
  defaultFrame,
  emptyWorkspaceDocument,
  extractWorkspaceActionBlock,
  inverseWorkspaceAction,
  parseHttpWorkspaceAction,
  parseWorkspaceDocument,
  readAssistantWorkspaceAction,
  type WorkspaceAction,
  type WorkspaceObject,
} from "./workspace-document";

function chat(id: string, x = 48): WorkspaceObject {
  return {
    id,
    type: "chat",
    title: "Chat",
    z: 1,
    collapsed: false,
    frame: { x, y: 48, width: 360, height: 280 },
    accent: null,
    tags: [],
    payload: { conversationId: "conv-1" },
  };
}

describe("workspace document", () => {
  it("round-trips a moved window and a chat-task link", () => {
    const created = applyWorkspaceAction(emptyWorkspaceDocument(), { type: "workspace.create", object: chat("chat-1") });
    const task: WorkspaceObject = { ...chat("task-1", 420), type: "task", title: "Task", payload: { taskId: "task-1" }, z: 2 };
    const withTask = applyWorkspaceAction(created.doc, { type: "workspace.create", object: task });
    const linked = applyWorkspaceAction(withTask.doc, {
      type: "workspace.link",
      relationship: { id: "rel-1", kind: "chat-task", fromId: "chat-1", toId: "task-1" },
    });
    const moved = applyWorkspaceAction(linked.doc, {
      type: "workspace.update",
      id: "chat-1",
      patch: { frame: { ...defaultFrame(0), x: 160, y: 96 } },
    });
    const parsed = parseWorkspaceDocument(JSON.parse(JSON.stringify(moved.doc)));
    expect(parsed.objects.find((object) => object.id === "chat-1")?.frame).toMatchObject({ x: 160, y: 96 });
    expect(parsed.relationships).toEqual([{ id: "rel-1", kind: "chat-task", fromId: "chat-1", toId: "task-1" }]);
  });

  it("delete unlinks the window and undo restores it without inventing a new row", () => {
    const start = applyWorkspaceAction(emptyWorkspaceDocument(), { type: "workspace.create", object: chat("chat-1") }).doc;
    const action = { type: "workspace.delete", id: "chat-1" } as const;
    const inverse = inverseWorkspaceAction(start, action);
    const deleted = applyWorkspaceAction(start, action).doc;
    expect(deleted.objects).toHaveLength(0);
    const restored = applyWorkspaceAction(deleted, inverse!);
    expect(restored.doc.objects[0]?.payload).toEqual({ conversationId: "conv-1" });
  });

  it("undo and redo restore create, move, resize, rename, z-order, duplicate, delete, and link", () => {
    const chatObject = chat("chat-1");
    const taskObject: WorkspaceObject = { ...chat("task-1", 420), type: "task", title: "Task", payload: { taskId: "task-1" }, z: 2 };
    let doc = emptyWorkspaceDocument();
    const steps: WorkspaceAction[] = [
      { type: "workspace.create", object: chatObject },
      { type: "workspace.create", object: taskObject },
      { type: "workspace.update", id: "chat-1", patch: { frame: { x: 160, y: 80, width: 360, height: 280 } } },
      { type: "workspace.update", id: "chat-1", patch: { frame: { x: 160, y: 80, width: 400, height: 320 } } },
      { type: "workspace.update", id: "chat-1", patch: { title: "Renamed" } },
      { type: "workspace.reorder", id: "chat-1", direction: "forward" },
      { type: "workspace.create", object: { ...chatObject, id: "chat-2", title: "Copy of Chat", z: 4, frame: { ...chatObject.frame, x: 80 } } },
      { type: "workspace.link", relationship: { id: "rel-1", kind: "chat-task", fromId: "chat-1", toId: "task-1" } },
      { type: "workspace.delete", id: "chat-2" },
    ];
    const inverses: WorkspaceAction[] = [];
    for (const action of steps) {
      const inverse = inverseWorkspaceAction(doc, action);
      expect(inverse).toBeTruthy();
      inverses.push(inverse!);
      doc = applyWorkspaceAction(doc, action).doc;
    }
    expect(doc.objects.find((object) => object.id === "chat-1")).toMatchObject({ title: "Renamed", z: 2 });
    expect(doc.relationships).toHaveLength(1);
    expect(doc.objects.some((object) => object.id === "chat-2")).toBe(false);
    for (const inverse of inverses.reverse()) doc = applyWorkspaceAction(doc, inverse).doc;
    expect(doc.objects).toHaveLength(0);
    expect(doc.relationships).toHaveLength(0);
  });

  it("rejects a malformed or unknown workspace action and accepts a valid one", () => {
    expect(readAssistantWorkspaceAction("no fence").ok).toBe(false);
    expect(readAssistantWorkspaceAction("```workspace-action\n{not json}\n```")).toEqual({ ok: false, reason: "malformed" });
    expect(readAssistantWorkspaceAction("```workspace-action\n{\"type\":\"workspace.explode\"}\n```")).toEqual({ ok: false, reason: "unknown" });
    expect(readAssistantWorkspaceAction("Done.\n```workspace-action\n{\"type\":\"workspace.create\",\"objectType\":\"note\",\"title\":\"Scratch\"}\n```")).toEqual({
      ok: true,
      action: { type: "workspace.create", objectType: "note", title: "Scratch", linkToId: undefined },
    });
  });

  it("reads one fenced workspace action and ignores prose", () => {
    const parsed = parseHttpWorkspaceAction(extractWorkspaceActionBlock("Done.\n```workspace-action\n{\"type\":\"workspace.create\",\"objectType\":\"task\",\"title\":\"Ship\"}\n```"));
    expect(parsed).toEqual({ type: "workspace.create", objectType: "task", title: "Ship", linkToId: undefined });
    expect(extractWorkspaceActionBlock("no fence")).toBeNull();
  });
});
