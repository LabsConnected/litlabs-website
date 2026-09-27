import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import WorktabBar from "./WorktabBar";
import type { WorktabBadge } from "../stores/useExecutionStore";
import type { Worktab } from "../hooks/useServerWorktabs";

const TAB_A: Worktab = {
  id: "tab-a",
  title: "Homepage",
  conversationId: "conv-a",
  surface: "studio/preview",
  selection: null,
  createdAt: 1,
};
const TAB_B: Worktab = {
  id: "tab-b",
  title: "Untitled 1",
  conversationId: null,
  surface: "studio/code",
  selection: null,
  createdAt: 2,
};

function renderBar(overrides: Partial<Parameters<typeof WorktabBar>[0]> = {}) {
  const props = {
    tabs: [TAB_A, TAB_B],
    activeId: "tab-a",
    badges: { "tab-a": "idle", "tab-b": "idle" } as Record<string, WorktabBadge>,
    onSwitch: vi.fn(),
    onClose: vi.fn(),
    onNew: vi.fn(),
    closedTabs: [],
    onReopen: vi.fn(),
    ...overrides,
  };
  const utils = render(<WorktabBar {...props} />);
  return { ...utils, props };
}

describe("WorktabBar", () => {
  it("renders each tab with a title, close button, and a new-tab button", () => {
    renderBar();
    expect(screen.getByTestId("worktab-bar")).toHaveAttribute("role", "tablist");
    expect(screen.getByTestId("worktab-switch-tab-a")).toHaveTextContent("Homepage");
    expect(screen.getByTestId("worktab-switch-tab-b")).toHaveTextContent("Untitled 1");
    expect(screen.getByTestId("worktab-close-tab-a")).toHaveAttribute("aria-label", "Close Homepage");
    expect(screen.getByTestId("worktab-new")).toHaveAttribute("aria-label", "New worktab");
  });

  it("marks only the active tab selected", () => {
    renderBar();
    expect(screen.getByTestId("worktab-tab-a")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("worktab-tab-b")).toHaveAttribute("aria-selected", "false");
  });

  it("switches tabs on title click", async () => {
    const user = userEvent.setup();
    const { props } = renderBar();
    await user.click(screen.getByTestId("worktab-switch-tab-b"));
    expect(props.onSwitch).toHaveBeenCalledWith("tab-b");
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("closes tabs on × click", async () => {
    const user = userEvent.setup();
    const { props } = renderBar();
    await user.click(screen.getByTestId("worktab-close-tab-b"));
    expect(props.onClose).toHaveBeenCalledWith("tab-b");
    expect(props.onSwitch).not.toHaveBeenCalled();
  });

  it("creates a tab on + click", async () => {
    const user = userEvent.setup();
    const { props } = renderBar();
    await user.click(screen.getByTestId("worktab-new"));
    expect(props.onNew).toHaveBeenCalledTimes(1);
  });

  it("shows a working badge only on the tab with live work", () => {
    renderBar({ badges: { "tab-a": "working", "tab-b": "idle" } });
    const badge = screen.getByTestId("worktab-badge-tab-a");
    expect(badge).toHaveAttribute("aria-label", "Run in progress");
    expect(screen.queryByTestId("worktab-badge-tab-b")).toBeNull();
  });

  it("shows a ready badge only on real completion", () => {
    renderBar({ badges: { "tab-a": "ready", "tab-b": "idle" } });
    expect(screen.getByTestId("worktab-badge-tab-a")).toHaveAttribute("aria-label", "Run complete");
    expect(screen.getByTestId("worktab-badge-tab-a")).toHaveTextContent("✓");
    expect(screen.queryByTestId("worktab-badge-tab-b")).toBeNull();
  });

  it("shows a needs-approval badge at an approval gate", () => {
    renderBar({ badges: { "tab-a": "needs-approval", "tab-b": "idle" } });
    const badge = screen.getByTestId("worktab-badge-tab-a");
    expect(badge).toHaveAttribute("aria-label", "Needs approval");
    expect(badge).toHaveTextContent("⚠");
  });

  it("shows no badge when tabs are idle", () => {
    renderBar({ badges: { "tab-a": "idle", "tab-b": "idle" } });
    expect(screen.queryByTestId("worktab-badge-tab-a")).toBeNull();
    expect(screen.queryByTestId("worktab-badge-tab-b")).toBeNull();
  });

  it("renders just the + button when there are no tabs", () => {
    render(<WorktabBar tabs={[]} activeId={null} badges={{}} onSwitch={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} closedTabs={[]} onReopen={vi.fn()} />);
    expect(screen.getByTestId("worktab-bar")).toBeTruthy();
    expect(screen.getByTestId("worktab-new")).toBeTruthy();
  });

  it("hides the reopen affordance when nothing is closed", () => {
    renderBar({ closedTabs: [] });
    expect(screen.queryByTestId("worktab-reopen-toggle")).toBeNull();
  });

  it("reopens a closed tab from the recently-closed menu", async () => {
    const user = userEvent.setup();
    const { props } = renderBar({
      closedTabs: [{ id: "tab-c", title: "Old work" }],
    });
    await user.click(screen.getByTestId("worktab-reopen-toggle"));
    expect(screen.getByTestId("worktab-reopen-menu")).toBeTruthy();
    await user.click(screen.getByTestId("worktab-reopen-tab-c"));
    expect(props.onReopen).toHaveBeenCalledWith("tab-c");
    expect(screen.queryByTestId("worktab-reopen-menu")).toBeNull();
  });

  it("dismisses the reopen menu on Escape", async () => {
    const user = userEvent.setup();
    renderBar({ closedTabs: [{ id: "tab-c", title: "Old work" }] });
    await user.click(screen.getByTestId("worktab-reopen-toggle"));
    expect(screen.getByTestId("worktab-reopen-menu")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("worktab-reopen-menu")).toBeNull();
  });
});
