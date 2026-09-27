import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { applyWorkspaceAction, emptyWorkspaceDocument, type WorkspaceDocument } from "@/lib/studio/workspace-document";
import { SpatialWorkspace } from "./SpatialWorkspace";
import { useWorkspaceStore } from "./workspace-store";

let document: WorkspaceDocument;
let revision: number;

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
}

describe("SpatialWorkspace", () => {
  beforeEach(() => {
    document = applyWorkspaceAction(emptyWorkspaceDocument(), {
      type: "workspace.create",
      object: {
        id: "chat-1",
        type: "chat",
        title: "Alpha",
        z: 1,
        collapsed: false,
        frame: { x: 48, y: 48, width: 360, height: 280 },
        accent: null,
        tags: [],
        payload: { conversationId: "conv-1" },
      },
    }).doc;
    revision = 1;
    useWorkspaceStore.setState({
      projectId: null,
      status: "idle",
      error: null,
      document: emptyWorkspaceDocument(),
      revision: 0,
      selectedIds: [],
      undo: [],
      redo: [],
      pendingActions: [],
    });
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/messages")) return json({ messages: [], revision: 1 });
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { action: { type: string; id?: string; frame?: WorkspaceDocument["objects"][number]["frame"] } };
        if (body.action.type === "workspace.update" && body.action.id && body.action.frame) {
          const applied = applyWorkspaceAction(document, { type: "workspace.update", id: body.action.id, patch: { frame: body.action.frame } });
          document = applied.doc;
          revision += 1;
        }
        return json({ document, revision, result: {} });
      }
      return json({ document, revision });
    }));
  });

  it("keeps a moved window after the workspace is saved and loaded again", async () => {
    const view = render(<SpatialWorkspace projectId="project-1" />);
    await waitFor(() => expect(screen.getByTestId("workspace-window-chat-1")).toBeTruthy());
    const title = screen.getByTestId("workspace-title-chat-1");
    fireEvent.pointerDown(title, { clientX: 80, clientY: 60, button: 0, pointerId: 1 });
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 180, clientY: 120 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 180, clientY: 120 }));
    await waitFor(() => expect(document.objects[0]?.frame.x).toBeGreaterThan(48));
    view.unmount();
    render(<SpatialWorkspace projectId="project-1" />);
    await waitFor(() => {
      const window = screen.getByTestId("workspace-window-chat-1");
      expect(window.getAttribute("style")).toContain(`left: ${document.objects[0]?.frame.x}px`);
    });
  });
});
