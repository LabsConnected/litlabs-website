import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { applyWorkspaceAction, emptyWorkspaceDocument, readAssistantWorkspaceAction, type WorkspaceDocument } from "@/lib/studio/workspace-document";
import { SpatialWorkspace } from "./SpatialWorkspace";
import { WorkspaceInspector } from "./WorkspaceInspector";
import { useWorkspaceStore } from "./workspace-store";

let workspace: WorkspaceDocument;
let revision: number;

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
}

describe("SpatialWorkspace", () => {
  beforeEach(() => {
    workspace = applyWorkspaceAction(emptyWorkspaceDocument(), {
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
      unavailable: false,
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
        const action = body.action as {
      type: string;
      id?: string;
      direction?: "forward" | "backward";
      viewport?: WorkspaceDocument["viewport"];
      frame?: WorkspaceDocument["objects"][number]["frame"];
      title?: string;
      patch?: { title?: string; frame?: WorkspaceDocument["objects"][number]["frame"] };
    };
        if (action.type === "workspace.update" && action.id && (action.frame || action.title || action.patch)) {
          const applied = applyWorkspaceAction(workspace, {
            type: "workspace.update",
            id: action.id,
            patch: { ...(action.patch ?? {}), ...(action.frame ? { frame: action.frame } : {}), ...(action.title ? { title: action.title } : {}) },
          });
          if (!applied.error) {
            workspace = applied.doc;
            revision += 1;
          }
        }
        if (action.type === "workspace.delete" && action.id) {
          const applied = applyWorkspaceAction(workspace, { type: "workspace.delete", id: action.id });
          if (!applied.error) {
            workspace = applied.doc;
            revision += 1;
          }
        }
        if (action.type === "workspace.reorder" && action.id && (action.direction === "forward" || action.direction === "backward")) {
          const applied = applyWorkspaceAction(workspace, { type: "workspace.reorder", id: action.id, direction: action.direction });
          if (!applied.error) {
            workspace = applied.doc;
            revision += 1;
          }
        }
        if (action.type === "workspace.focus" && action.id) {
          const applied = applyWorkspaceAction(workspace, { type: "workspace.focus", id: action.id });
          if (!applied.error) {
            workspace = applied.doc;
            revision += 1;
          }
        }
        if (action.type === "workspace.duplicate" && action.id) {
          const source = workspace.objects.find((object) => object.id === action.id);
          if (source) {
            const applied = applyWorkspaceAction(workspace, {
              type: "workspace.create",
              object: {
                ...source,
                id: `${source.id}-copy`,
                title: `Copy of ${source.title}`,
                z: source.z + 10,
                frame: { ...source.frame, x: source.frame.x + 32, y: source.frame.y + 32 },
                tags: [...source.tags],
                payload: { ...source.payload },
              },
            });
            if (!applied.error) {
              workspace = applied.doc;
              revision += 1;
            }
          }
        }
        if (action.type === "workspace.viewport" && action.viewport) {
          const applied = applyWorkspaceAction(workspace, { type: "workspace.viewport", viewport: action.viewport });
          if (!applied.error) {
            workspace = applied.doc;
            revision += 1;
          }
        }
        return json({ document: workspace, revision, result: {} });
      }
      return json({ document: workspace, revision });
    }));
  });

  it("keeps a moved window after the workspace is saved and loaded again", async () => {
    const view = render(<SpatialWorkspace projectId="project-1" />);
    await waitFor(() => expect(screen.getByTestId("workspace-window-chat-1")).toBeTruthy());
    const title = screen.getByTestId("workspace-title-chat-1");
    fireEvent.pointerDown(title, { clientX: 80, clientY: 60, button: 0, pointerId: 1 });
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 180, clientY: 120 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 180, clientY: 120 }));
    await waitFor(() => expect(workspace.objects[0]?.frame.x).toBeGreaterThan(48));
    view.unmount();
    render(<SpatialWorkspace projectId="project-1" />);
    await waitFor(() => {
      const windowNode = screen.getByTestId("workspace-window-chat-1");
      expect(windowNode.getAttribute("style")).toContain(`left: ${workspace.objects[0]?.frame.x}px`);
    });
  });

  it("pans the background without moving a window, and a title drag does move it", async () => {
    render(<SpatialWorkspace projectId="project-1" />);
    await waitFor(() => screen.getByTestId("workspace-window-chat-1"));
    const canvas = screen.getByTestId("workspace-canvas");
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 160, clientY: 90 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 160, clientY: 90 }));
    expect(workspace.objects[0]?.frame).toMatchObject({ x: 48, y: 48 });

    const title = screen.getByTestId("workspace-title-chat-1");
    fireEvent.pointerDown(title, { clientX: 80, clientY: 60, button: 0, pointerId: 2 });
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 200, clientY: 140 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 200, clientY: 140 }));
    await waitFor(() => expect(workspace.objects[0]?.frame.x).toBeGreaterThan(48));
  });

  it("shift-click and marquee select more than one window", async () => {
    workspace = applyWorkspaceAction(workspace, {
      type: "workspace.create",
      object: {
        id: "task-1",
        type: "task",
        title: "Task",
        z: 2,
        collapsed: false,
        frame: { x: 480, y: 48, width: 360, height: 280 },
        accent: null,
        tags: [],
        payload: { taskId: "task-1" },
      },
    }).doc;
    render(<SpatialWorkspace projectId="project-1" />);
    await waitFor(() => screen.getByTestId("workspace-window-task-1"));
    fireEvent.pointerDown(screen.getByTestId("workspace-title-chat-1"), { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 20, clientY: 20 }));
    screen.getByTestId("workspace-title-task-1").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, clientX: 30, clientY: 20 }));
    await waitFor(() => {
      expect(screen.getByTestId("workspace-window-chat-1").getAttribute("data-selected")).toBe("true");
      expect(screen.getByTestId("workspace-window-task-1").getAttribute("data-selected")).toBe("true");
    });

    useWorkspaceStore.getState().select([]);
    const canvas = screen.getByTestId("workspace-canvas");
    canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 900, clientY: 400 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 900, clientY: 400 }));
    await waitFor(() => expect(useWorkspaceStore.getState().selectedIds.sort()).toEqual(["chat-1", "task-1"]));
  });

  it("ignores delete while typing in an input, a textarea, contenteditable, or xterm", async () => {
    render(<SpatialWorkspace projectId="project-1" />);
    const input = await screen.findByLabelText("Message this chat");
    fireEvent.keyDown(input, { key: "Delete" });
    const area = globalThis.document.createElement("textarea");
    const editable = globalThis.document.createElement("div");
    editable.contentEditable = "true";
    const term = globalThis.document.createElement("div");
    term.className = "xterm";
    const termInner = globalThis.document.createElement("textarea");
    term.appendChild(termInner);
    globalThis.document.body.append(area, editable, term);
    fireEvent.keyDown(area, { key: "Delete" });
    fireEvent.keyDown(editable, { key: "Delete" });
    fireEvent.keyDown(termInner, { key: "Backspace" });
    useWorkspaceStore.getState().select(["chat-1"]);
    fireEvent.keyDown(input, { key: "Delete" });
    expect(workspace.objects).toHaveLength(1);
    fireEvent.keyDown(screen.getByTestId("workspace-canvas"), { key: "Delete" });
    await waitFor(() => expect(workspace.objects).toHaveLength(0));
  });

  it("keeps the inspector geometry in sync with a title drag", async () => {
    render(<><SpatialWorkspace projectId="project-1" /><WorkspaceInspector /></>);
    await waitFor(() => screen.getByTestId("workspace-window-chat-1"));
    useWorkspaceStore.getState().select(["chat-1"]);
    const title = screen.getByTestId("workspace-title-chat-1");
    fireEvent.pointerDown(title, { clientX: 80, clientY: 60, button: 0, pointerId: 1 });
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 200, clientY: 140 }));
    await waitFor(() => {
      const input = screen.getByLabelText("Frame x") as HTMLInputElement;
      expect(Number(input.value)).toBeGreaterThan(48);
    });
  });

  it("saves an inspector title edit onto the window", async () => {
    render(<><SpatialWorkspace projectId="project-1" /><WorkspaceInspector /></>);
    await waitFor(() => screen.getByTestId("workspace-window-chat-1"));
    useWorkspaceStore.getState().select(["chat-1"]);
    const title = await screen.findByLabelText("Window title");
    fireEvent.change(title, { target: { value: "Beta" } });
    fireEvent.blur(title);
    await waitFor(() => expect(screen.getByTestId("workspace-window-chat-1").textContent).toContain("Beta"));
    const puts = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((call) => String((call[1] as RequestInit | undefined)?.body ?? ""));
    expect(puts.some((body) => body.includes("Beta"))).toBe(true);
  });

  it("duplicates, deletes, reorders, and focuses the selected window", async () => {
    workspace = applyWorkspaceAction(workspace, {
      type: "workspace.create",
      object: {
        id: "task-1",
        type: "task",
        title: "Task",
        z: 2,
        collapsed: false,
        frame: { x: 480, y: 48, width: 360, height: 280 },
        accent: null,
        tags: [],
        payload: { taskId: "task-1" },
      },
    }).doc;
    workspace = applyWorkspaceAction(workspace, {
      type: "workspace.update",
      id: "chat-1",
      patch: { collapsed: true },
    }).doc;
    render(<SpatialWorkspace projectId="project-1" />);
    await waitFor(() => screen.getByTestId("workspace-window-task-1"));
    useWorkspaceStore.getState().select(["chat-1"]);
    await waitFor(() => expect(screen.getByTestId("workspace-window-chat-1").getAttribute("data-selected")).toBe("true"));
    fireEvent.click(screen.getByTestId("workspace-bring-forward"));
    await waitFor(() => expect(workspace.objects.find((object) => object.id === "chat-1")?.z).toBe(2));
    fireEvent.click(screen.getByTestId("workspace-send-backward"));
    await waitFor(() => expect(workspace.objects.find((object) => object.id === "chat-1")?.z).toBe(1));
    fireEvent.click(screen.getByTestId("workspace-focus"));
    await waitFor(() => {
      const chat = workspace.objects.find((object) => object.id === "chat-1");
      expect(chat?.collapsed).toBe(false);
      expect(chat?.z).toBeGreaterThan(1);
    });
    fireEvent.click(screen.getByTestId("workspace-duplicate"));
    await waitFor(() => expect(screen.getByTestId("workspace-window-chat-1-copy").getAttribute("data-selected")).toBe("true"));
    fireEvent.click(screen.getByTestId("workspace-delete"));
    await waitFor(() => expect(workspace.objects.some((object) => object.id === "chat-1-copy")).toBe(false));
    expect(workspace.objects.some((object) => object.id === "chat-1")).toBe(true);
  });

  it("shows an empty workspace, a loading state, and a load error", async () => {
    workspace = emptyWorkspaceDocument();
    const emptyView = render(<SpatialWorkspace projectId="project-1" />);
    expect((await screen.findByTestId("workspace-empty")).textContent).toMatch(/empty/i);
    emptyView.unmount();

    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const loadingView = render(<SpatialWorkspace projectId="project-2" />);
    expect(await screen.findByTestId("workspace-loading")).toBeTruthy();
    expect(screen.queryByTestId("workspace-empty")).toBeNull();
    loadingView.unmount();

    vi.stubGlobal("fetch", vi.fn(() => json({ error: "The workspace could not be loaded." }, 500)));
    render(<SpatialWorkspace projectId="project-3" />);
    expect((await screen.findByTestId("workspace-error")).textContent).toMatch(/could not be loaded/i);
    expect(screen.queryByTestId("workspace-persistence-unavailable")).toBeNull();
    expect(screen.queryByTestId("workspace-empty")).toBeNull();
  });

  it("shows a migration message when workspace storage returns 503", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "The workspace table is not available yet. Apply the studio_workspaces migration, then reload." }, 503)));
    render(<SpatialWorkspace projectId="project-1" />);
    expect((await screen.findByTestId("workspace-persistence-unavailable")).textContent).toMatch(/migration/i);
    expect(screen.queryByTestId("workspace-empty")).toBeNull();
  });

  it("pans when the minimap is clicked", async () => {
    render(<SpatialWorkspace projectId="project-1" />);
    await waitFor(() => screen.getByTestId("workspace-minimap"));
    fireEvent.click(screen.getByTestId("workspace-minimap"), { clientX: 40, clientY: 30 });
    await waitFor(() => {
      const puts = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .map((call) => String((call[1] as RequestInit | undefined)?.body ?? ""));
      expect(puts.some((body) => body.includes("workspace.viewport"))).toBe(true);
    });
  });

  it("sends a valid fenced workspace action through the API and drops a bad one", async () => {
    const bad = readAssistantWorkspaceAction("```workspace-action\n{not json}\n```");
    const unknown = readAssistantWorkspaceAction("```workspace-action\n{\"type\":\"workspace.explode\"}\n```");
    expect(bad).toEqual({ ok: false, reason: "malformed" });
    expect(unknown).toEqual({ ok: false, reason: "unknown" });
    const valid = readAssistantWorkspaceAction("```workspace-action\n{\"type\":\"workspace.create\",\"objectType\":\"note\",\"title\":\"Scratch\"}\n```");
    expect(valid.ok).toBe(true);
    render(<SpatialWorkspace projectId="project-1" />);
    await waitFor(() => expect(useWorkspaceStore.getState().status).toBe("ready"));
    if (valid.ok) useWorkspaceStore.getState().enqueueAction(valid.action);
    await waitFor(() => {
      const puts = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .map((call) => String((call[1] as RequestInit | undefined)?.body ?? ""));
      expect(puts.some((body) => body.includes("\"objectType\":\"note\"") && body.includes("Scratch"))).toBe(true);
    });
  });
});
