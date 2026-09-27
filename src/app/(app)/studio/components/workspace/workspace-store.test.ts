import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyWorkspaceAction, emptyWorkspaceDocument, inverseWorkspaceAction, type WorkspaceAction, type WorkspaceDocument } from "@/lib/studio/workspace-document";
import { useWorkspaceStore } from "./workspace-store";

let document: WorkspaceDocument;
let revision: number;

function resetStore() {
  useWorkspaceStore.setState({
    projectId: "project-1",
    status: "ready",
    unavailable: false,
    error: null,
    document,
    revision,
    selectedIds: [],
    undo: [],
    redo: [],
    pendingActions: [],
  });
}

describe("workspace store undo and redo", () => {
  beforeEach(() => {
    document = applyWorkspaceAction(emptyWorkspaceDocument(), {
      type: "workspace.create",
      object: {
        id: "note-1",
        type: "chat",
        title: "Note",
        z: 1,
        collapsed: false,
        frame: { x: 48, y: 48, width: 360, height: 280 },
        accent: null,
        tags: [],
        payload: { body: "" },
      },
    }).doc;
    document = applyWorkspaceAction(document, {
      type: "workspace.create",
      object: {
        id: "note-2",
        type: "task",
        title: "Other",
        z: 2,
        collapsed: false,
        frame: { x: 420, y: 48, width: 360, height: 280 },
        accent: null,
        tags: [],
        payload: { body: "" },
      },
    }).doc;
    revision = 1;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action: WorkspaceAction & { frame?: WorkspaceDocument["objects"][number]["frame"]; title?: string } };
      const action = body.action.type === "workspace.update"
        ? { type: "workspace.update" as const, id: body.action.id, patch: { ...(body.action.patch ?? {}), ...(body.action.frame ? { frame: body.action.frame } : {}), ...(body.action.title ? { title: body.action.title } : {}) } }
        : body.action;
      const applied = applyWorkspaceAction(document, action);
      if (!applied.error) {
        document = applied.doc;
        revision += 1;
      }
      return { ok: !applied.error, status: applied.error ? 400 : 200, json: async () => ({ document, revision, result: {} }) };
    }));
    resetStore();
  });

  async function commit(action: WorkspaceAction) {
    const inverse = inverseWorkspaceAction(useWorkspaceStore.getState().document, action);
    const ok = await useWorkspaceStore.getState().commit(action as never, inverse);
    expect(ok).toBe(true);
  }

  it("undo and redo a move, resize, rename, reorder, delete, and link through the API", async () => {
    await commit({ type: "workspace.update", id: "note-1", patch: { frame: { x: 160, y: 64, width: 360, height: 280 } } });
    await commit({ type: "workspace.update", id: "note-1", patch: { frame: { x: 160, y: 64, width: 400, height: 320 } } });
    await commit({ type: "workspace.update", id: "note-1", patch: { title: "Renamed" } });
    await commit({ type: "workspace.reorder", id: "note-1", direction: "forward" });
    await commit({ type: "workspace.link", relationship: { id: "rel-1", kind: "chat-task", fromId: "note-1", toId: "note-2" } });
    await commit({ type: "workspace.delete", id: "note-2" });
    expect(useWorkspaceStore.getState().document.objects.map((object) => object.id)).toEqual(["note-1"]);
    expect(useWorkspaceStore.getState().document.objects[0]?.title).toBe("Renamed");

    for (let step = 0; step < 6; step += 1) await useWorkspaceStore.getState().undoAction();
    expect(useWorkspaceStore.getState().document.objects.map((object) => object.id).sort()).toEqual(["note-1", "note-2"]);
    expect(useWorkspaceStore.getState().document.objects.find((object) => object.id === "note-1")).toMatchObject({
      title: "Note",
      frame: { x: 48, y: 48, width: 360, height: 280 },
      z: 1,
    });
    expect(useWorkspaceStore.getState().document.relationships).toHaveLength(0);

    for (let step = 0; step < 6; step += 1) await useWorkspaceStore.getState().redoAction();
    expect(useWorkspaceStore.getState().document.objects).toHaveLength(1);
    expect(useWorkspaceStore.getState().document.objects[0]?.title).toBe("Renamed");
    const puts = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "PUT");
    expect(puts.length).toBeGreaterThan(6);
  });
});
