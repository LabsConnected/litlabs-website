import { describe, it, expect, beforeEach } from "vitest";
import { useStudioWindowStore, type OpenWindowInput } from "./useStudioWindowStore";

const PROJECT = "proj-test";

function resetStore() {
  localStorage.clear();
  useStudioWindowStore.setState({
    windows: {},
    activeWindowId: null,
    zCounter: 40,
    hydratedProjects: {},
  });
}

const open = (input: OpenWindowInput) => useStudioWindowStore.getState().openWindow(input);

describe("useStudioWindowStore", () => {
  beforeEach(resetStore);

  it("opens a window bound to a task with staggered default bounds", () => {
    const id = open({ type: "chat", taskId: "t1", projectId: PROJECT });
    const win = useStudioWindowStore.getState().windows[id];
    expect(win).toBeTruthy();
    expect(win.taskId).toBe("t1");
    expect(win.projectId).toBe(PROJECT);
    expect(win.bounds.width).toBeGreaterThanOrEqual(220);
    expect(useStudioWindowStore.getState().activeWindowId).toBe(id);
  });

  it("singleton windows re-focus instead of duplicating", () => {
    const a = open({ type: "preview", taskId: "t1", projectId: PROJECT, singleton: true });
    const b = open({ type: "preview", taskId: "t1", projectId: PROJECT, singleton: true });
    expect(b).toBe(a);
    const previews = Object.values(useStudioWindowStore.getState().windows).filter((w) => w.type === "preview");
    expect(previews).toHaveLength(1);
  });

  it("allows the same tool type on different tasks", () => {
    const a = open({ type: "preview", taskId: "t1", projectId: PROJECT, singleton: true });
    const b = open({ type: "preview", taskId: "t2", projectId: PROJECT, singleton: true });
    expect(a).not.toBe(b);
    expect(Object.keys(useStudioWindowStore.getState().windows)).toHaveLength(2);
  });

  it("spawns multiple chat windows on one task when not singleton", () => {
    open({ type: "chat", taskId: "t1", projectId: PROJECT });
    open({ type: "chat", taskId: "t1", projectId: PROJECT });
    const chats = Object.values(useStudioWindowStore.getState().windows).filter((w) => w.type === "chat");
    expect(chats).toHaveLength(2);
  });

  it("focus raises z-index and unminimizes", () => {
    const a = open({ type: "chat", taskId: "t1", projectId: PROJECT });
    const b = open({ type: "preview", taskId: "t1", projectId: PROJECT });
    const s = useStudioWindowStore.getState();
    s.minimizeWindow(a);
    s.focusWindow(a);
    const wa = useStudioWindowStore.getState().windows[a];
    const wb = useStudioWindowStore.getState().windows[b];
    expect(wa.state.minimized).toBe(false);
    expect(wa.zIndex).toBeGreaterThan(wb.zIndex);
    expect(useStudioWindowStore.getState().activeWindowId).toBe(a);
  });

  it("minimize keeps the record mounted-flagged; close removes it", () => {
    const id = open({ type: "terminal", taskId: "t1", projectId: PROJECT });
    const s = useStudioWindowStore.getState();
    s.minimizeWindow(id);
    expect(useStudioWindowStore.getState().windows[id].state.minimized).toBe(true);
    s.closeWindow(id);
    expect(useStudioWindowStore.getState().windows[id]).toBeUndefined();
    expect(useStudioWindowStore.getState().activeWindowId).toBeNull();
  });

  it("maximize stores restoreBounds; toggling restores geometry", () => {
    const id = open({ type: "files", taskId: "t1", projectId: PROJECT });
    const s = useStudioWindowStore.getState();
    const before = useStudioWindowStore.getState().windows[id].bounds;
    s.maximizeWindow(id);
    const maxed = useStudioWindowStore.getState().windows[id];
    expect(maxed.state.maximized).toBe(true);
    expect(maxed.restoreBounds).toEqual(before);
    s.maximizeWindow(id);
    const restored = useStudioWindowStore.getState().windows[id];
    expect(restored.state.maximized).toBe(false);
    expect(restored.bounds).toEqual(before);
  });

  it("persists windows per project and hydrates them on a fresh project id", async () => {
    const id = open({ type: "preview", taskId: "t1", projectId: "proj-A", viewState: { url: "/x" } });
    // Update bounds → debounced persist — wait past the debounce window.
    useStudioWindowStore.getState().updateBounds(id, { x: 99, y: 88 });
    await new Promise((r) => setTimeout(r, 400));

    // Simulate a new session: wipe the in-memory store, keep localStorage.
    useStudioWindowStore.setState({ windows: {}, activeWindowId: null, zCounter: 40, hydratedProjects: {} });
    useStudioWindowStore.getState().hydrateProject("proj-A");
    const revived = Object.values(useStudioWindowStore.getState().windows);
    expect(revived).toHaveLength(1);
    expect(revived[0].bounds.x).toBe(99);
    expect(revived[0].viewState.url).toBe("/x");
    expect(revived[0].taskId).toBe("t1");
  });

  it("scopes persistence per project — another project stays empty", () => {
    open({ type: "chat", taskId: "t1", projectId: "proj-A" });
    useStudioWindowStore.getState().hydrateProject("proj-B");
    const inB = Object.values(useStudioWindowStore.getState().windows).filter((w) => w.projectId === "proj-B");
    expect(inB).toHaveLength(0);
  });

  it("resetWorkspace removes only that project's windows", () => {
    open({ type: "chat", taskId: "t1", projectId: "proj-A" });
    open({ type: "chat", taskId: "t1", projectId: "proj-B" });
    useStudioWindowStore.getState().resetWorkspace({ projectId: "proj-A" });
    const remaining = Object.values(useStudioWindowStore.getState().windows);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].projectId).toBe("proj-B");
    expect(localStorage.getItem("litt:studio:wm:v2:proj-A")).toBeNull();
  });

  it("updateBounds refuses while maximized or docked", () => {
    const id = open({ type: "chat", taskId: "t1", projectId: PROJECT });
    const s = useStudioWindowStore.getState();
    const before = useStudioWindowStore.getState().windows[id].bounds;
    s.maximizeWindow(id);
    s.updateBounds(id, { x: 9999 });
    expect(useStudioWindowStore.getState().windows[id].bounds).toEqual(before);
    s.maximizeWindow(id); // restore
    s.dockWindow(id, "left");
    s.updateBounds(id, { x: 9999 });
    expect(useStudioWindowStore.getState().windows[id].bounds).toEqual(before);
    s.dockWindow(id, null);
    s.updateBounds(id, { x: 77 });
    expect(useStudioWindowStore.getState().windows[id].bounds.x).toBe(77);
  });

  it("updateWindowState persists tool view-state (e.g. chat draft)", () => {
    const id = open({ type: "chat", taskId: "t1", projectId: PROJECT });
    useStudioWindowStore.getState().updateWindowState(id, { draft: "hello" });
    expect(useStudioWindowStore.getState().windows[id].viewState.draft).toBe("hello");
    const raw = JSON.parse(localStorage.getItem(`litt:studio:wm:v2:${PROJECT}`)!);
    expect(raw.windows[0].viewState.draft).toBe("hello");
  });
});
