import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import StudioDock, {
  type StudioDockTab,
} from "@/app/(app)/studio/components/StudioDock";

function renderDock(overrides: Partial<React.ComponentProps<typeof StudioDock>> = {}) {
  const props: React.ComponentProps<typeof StudioDock> = {
    open: true,
    activeTab: "activity",
    onTabChange: vi.fn(),
    onClose: vi.fn(),
    onToggle: vi.fn(),
    height: 320,
    onHeightChange: vi.fn(),
    activityContent: <div data-testid="activity-slot">activity</div>,
    filesContent: <div data-testid="files-slot">files</div>,
    terminalContent: <div data-testid="terminal-slot">terminal</div>,
    inspectorContent: <div data-testid="inspector-slot">inspector</div>,
    mediaContent: <div data-testid="media-slot">media</div>,
    ...overrides,
  };
  return { props, ...render(<StudioDock {...props} />) };
}

describe("StudioDock", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("renders all five tabs", () => {
    renderDock();
    expect(screen.getByTestId("studio-dock")).toBeDefined();
    for (const id of ["activity", "files", "terminal", "inspector", "media"]) {
      const tab = screen.getByTestId(`dock-tab-${id}`);
      expect(tab).toBeDefined();
      expect(tab.getAttribute("aria-selected")).toBe(
        id === "activity" ? "true" : "false",
      );
    }
  });

  it("clicking a tab calls onTabChange", () => {
    const { props } = renderDock();
    fireEvent.click(screen.getByTestId("dock-tab-files"));
    expect(props.onTabChange).toHaveBeenCalledWith("files");
  });

  it("clicking a tab while collapsed opens the dock and selects the tab", () => {
    const { props } = renderDock({ open: false });
    // Collapsed strip: content area is hidden
    expect(screen.queryByTestId("dock-content-activity")).toBeNull();
    fireEvent.click(screen.getByTestId("dock-collapsed-toggle"));
    fireEvent.click(screen.getByTestId("dock-tab-terminal"));
    expect(props.onTabChange).toHaveBeenCalledWith("terminal");
    expect(props.onToggle).toHaveBeenCalled();
    // Dock expanded — content area is now rendered
    expect(screen.getByTestId("dock-content-terminal")).toBeDefined();
  });

  it("close button calls onClose and collapses the dock", () => {
    const { props } = renderDock();
    fireEvent.click(screen.getByLabelText("Close dock"));
    expect(props.onClose).toHaveBeenCalled();
    // Collapsed: content area hidden again
    expect(screen.queryByTestId("dock-content-activity")).toBeNull();
  });

  it("keeps terminal content mounted with display:none when another tab is active", () => {
    renderDock({ activeTab: "files" });
    const terminal = screen.getByTestId("terminal-slot");
    expect(terminal).toBeDefined();
    const content = screen.getByTestId("dock-content-terminal");
    expect(content.style.display).toBe("none");
  });

  it("shows terminal content when the terminal tab is active", () => {
    renderDock({ activeTab: "terminal" });
    const content = screen.getByTestId("dock-content-terminal");
    expect(content.style.display).not.toBe("none");
    expect(screen.getByTestId("terminal-slot")).toBeDefined();
  });

  it("shows the activity pulse dot when activityPulse is true", () => {
    renderDock({ activityPulse: true });
    expect(screen.getByTestId("dock-activity-pulse")).toBeDefined();
  });

  it("hides the activity pulse dot when activityPulse is false", () => {
    renderDock({ activityPulse: false });
    expect(screen.queryByTestId("dock-activity-pulse")).toBeNull();
  });

  it("shows the terminal badge dot when terminalBadge is true", () => {
    renderDock({ terminalBadge: true });
    expect(screen.getByTestId("dock-terminal-badge")).toBeDefined();
  });

  it("collapsed strip renders when open=false", () => {
    renderDock({ open: false });
    const dock = screen.getByTestId("studio-dock");
    expect(dock.style.height).toBe("44px");
    expect(screen.getByTestId("dock-collapsed-toggle")).toBeDefined();
    expect(screen.getByText("Developer tools")).toBeDefined();
    // Controls are hidden in the collapsed strip
    expect(screen.queryByLabelText("Close dock")).toBeNull();
    expect(screen.queryByLabelText("Maximize")).toBeNull();
  });

  it("persists height and open state to its own sessionStorage keys", () => {
    renderDock({ open: true, height: 400 });
    expect(sessionStorage.getItem("studio-dock-open")).toBe("true");
    expect(sessionStorage.getItem("studio-dock-height")).toBe("400");
    // Must not reuse StudioDrawer's keys
    expect(sessionStorage.getItem("studio-terminal-height")).toBeNull();
    expect(sessionStorage.getItem("studio-terminal-open")).toBeNull();
  });

  it("Escape collapses the dock when maximized", () => {
    const { props } = renderDock();
    fireEvent.click(screen.getByLabelText("Maximize"));
    expect(screen.getByLabelText("Restore")).toBeDefined();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
    expect(screen.queryByTestId("dock-content-activity")).toBeNull();
  });

  it("ArrowUp/ArrowDown on the resize handle adjusts height", () => {
    const { props } = renderDock({ height: 320 });
    const handle = screen.getByLabelText("Drag to resize dock");
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(props.onHeightChange).toHaveBeenCalledWith(352);
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(props.onHeightChange).toHaveBeenCalledWith(288);
  });

  it("marks the active tab with aria-pressed and exposes all slots", () => {
    const tabs: StudioDockTab[] = [
      "activity",
      "files",
      "terminal",
      "inspector",
      "media",
    ];
    for (const tab of tabs) {
      const { unmount } = renderDock({ activeTab: tab });
      expect(
        screen.getByTestId(`dock-tab-${tab}`).getAttribute("aria-selected"),
      ).toBe("true");
      expect(screen.getByTestId(`${tab}-slot`)).toBeDefined();
      unmount();
    }
  });

  it("tab strip scrolls horizontally on narrow screens so all tabs stay reachable", () => {
    renderDock();
    // The tablist wraps the tab buttons; at 390px the five labeled tabs
    // overflow, so the strip must scroll instead of clipping them.
    const tablist = screen.getByRole("tablist", { name: "Studio dock tabs" });
    expect(tablist.className).toMatch(/overflow-x-auto/);
    // Desktop keeps the static strip.
    expect(tablist.className).toMatch(/sm:overflow-visible/);
  });
});
