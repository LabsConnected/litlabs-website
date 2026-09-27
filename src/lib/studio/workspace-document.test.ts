import { describe, expect, it } from "vitest";
import {
  applyWorkspaceAction,
  defaultFrame,
  emptyWorkspaceDocument,
  extractWorkspaceActionBlock,
  inverseWorkspaceAction,
  parseHttpWorkspaceAction,
  parseWorkspaceDocument,
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

  it("reads one fenced workspace action and ignores prose", () => {
    const parsed = parseHttpWorkspaceAction(extractWorkspaceActionBlock("Done.\n```workspace-action\n{\"type\":\"workspace.create\",\"objectType\":\"task\",\"title\":\"Ship\"}\n```"));
    expect(parsed).toEqual({ type: "workspace.create", objectType: "task", title: "Ship", linkToId: undefined });
    expect(extractWorkspaceActionBlock("no fence")).toBeNull();
  });
});
