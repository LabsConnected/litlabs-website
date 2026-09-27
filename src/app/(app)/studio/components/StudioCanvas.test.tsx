import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import StudioCanvas from "./StudioCanvas";
import { useStudioWindowStore } from "../stores/useStudioWindowStore";

const PROJECT = "proj-canvas-test";

function resetStore() {
  localStorage.clear();
  useStudioWindowStore.setState({
    windows: {},
    activeWindowId: null,
    zCounter: 40,
    hydratedProjects: {},
  });
}

function renderCanvas(overrides?: Partial<Parameters<typeof StudioCanvas>[0]>) {
  const props = {
    projectId: PROJECT,
    storageKey: "test",
    renderWindowContent: () => <div data-testid="win-body" />,
    onOpenTool: () => undefined,
    onResetWorkspace: () => undefined,
    ...overrides,
  };
  return render(<StudioCanvas {...props} />);
}

describe("StudioCanvas — window compositor", () => {
  beforeEach(resetStore);

  it("starts as a blank canvas with a launcher, not hidden dashboard surfaces", () => {
    renderCanvas();
    expect(screen.getByText("Blank canvas")).toBeTruthy();
    expect(screen.getByTestId("studio-new-window")).toBeTruthy();
    // No windows mounted → no page-level tool surfaces.
    expect(screen.queryByTestId("win-body")).toBeNull();
  });

  it("launcher menu routes each tool type to onOpenTool", async () => {
    const onOpenTool = vi.fn();
    renderCanvas({ onOpenTool });
    await userEvent.click(screen.getByTestId("studio-new-window"));
    await userEvent.click(screen.getByTestId("studio-open-preview"));
    expect(onOpenTool).toHaveBeenCalledWith("preview");
    // Menu closes after selection.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders a StudioWindowFrame per window record with resolved task title", () => {
    useStudioWindowStore.getState().openWindow({ type: "chat", taskId: "t1", projectId: PROJECT });
    renderCanvas({ resolveTaskTitle: (taskId) => (taskId === "t1" ? "Ship auth" : undefined) });
    const frame = document.querySelector("[data-studio-window]");
    expect(frame).toBeTruthy();
    expect(frame!.getAttribute("data-task-id")).toBe("t1");
    expect(screen.getByText("Ship auth")).toBeTruthy();
    expect(screen.getByTestId("win-body")).toBeTruthy();
  });

  it("minimize keeps the window mounted (state preserved) but hidden, surfaced on the taskbar", async () => {
    const id = useStudioWindowStore.getState().openWindow({ type: "terminal", taskId: "t1", projectId: PROJECT });
    renderCanvas();
    const frame = document.querySelector("[data-studio-window]")!;
    await act(async () => {
      useStudioWindowStore.getState().minimizeWindow(id);
    });
    expect(useStudioWindowStore.getState().windows[id]).toBeTruthy(); // record survives
    expect(frame.className).toContain("studio-freeform-window--minimized"); // mounted, display:none
    const chip = screen.getByTestId(`studio-taskbar-${id}`);
    await act(async () => { chip.click(); });
    expect(useStudioWindowStore.getState().windows[id].state.minimized).toBe(false);
  });

  it("close deletes the window record without touching the task", async () => {
    const id = useStudioWindowStore.getState().openWindow({ type: "preview", taskId: "t1", projectId: PROJECT });
    renderCanvas();
    await userEvent.click(screen.getByTestId("studio-window-close"));
    expect(useStudioWindowStore.getState().windows[id]).toBeUndefined();
    expect(screen.queryByTestId("win-body")).toBeNull();
  });

  it("reset button hands off to the caller — canvas doesn't reset itself", async () => {
    const onResetWorkspace = vi.fn();
    useStudioWindowStore.getState().openWindow({ type: "chat", taskId: "t1", projectId: PROJECT });
    renderCanvas({ onResetWorkspace });
    await userEvent.click(screen.getByTestId("studio-reset-workspace"));
    expect(onResetWorkspace).toHaveBeenCalledTimes(1);
  });

  it("hydrated windows render immediately on mount (layout survives refresh)", () => {
    // Simulate a prior session's persisted layout.
    localStorage.setItem(`litt:studio:wm:v2:${PROJECT}`, JSON.stringify({
      windows: [{
        id: "w1", type: "files", taskId: "t1", projectId: PROJECT, title: "Files",
        bounds: { x: 10, y: 10, width: 300, height: 300 }, zIndex: 41,
        state: { minimized: false, maximized: false, docked: null }, viewState: {},
        createdAt: "t", updatedAt: "t",
      }],
    }));
    // The route hydrates the project scope before rendering the canvas.
    useStudioWindowStore.getState().hydrateProject(PROJECT);
    renderCanvas();
    expect(document.querySelector("[data-studio-window]")).toBeTruthy();
  });
});
