import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ContextDrawer from "./ContextDrawer";

/**
 * Focused, unmocked tests for ContextDrawer (Phase C2.1).
 *
 * These specifically cover the bug the previous C2 report missed: the
 * drawer used to own its own `activeTab` state seeded from `initialTab`,
 * so the parent's persisted tab and the drawer's actually-visible tab
 * could disagree. ContextDrawer is now fully controlled — it must have
 * NO internal tab state at all.
 */
describe("ContextDrawer (real component)", () => {
  function renderDrawer(overrides: Partial<Parameters<typeof ContextDrawer>[0]> = {}) {
    const onTabChange = vi.fn();
    const onClose = vi.fn();
    const props = {
      open: true,
      activeTab: "files" as const,
      onTabChange,
      onClose,
      filesContent: <div data-testid="files-slot">Files content</div>,
      assetsContent: <div data-testid="assets-slot">Assets content</div>,
      inspectorContent: <div data-testid="inspector-slot">Inspector content</div>,
      ...overrides,
    };
    render(<ContextDrawer {...props} />);
    return { onTabChange, onClose };
  }

  it("shows the Files panel active when activeTab=files", () => {
    renderDrawer({ activeTab: "files" });
    expect(screen.getByTestId("context-files-panel")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("context-inspector-panel")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("context-tab-files")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("context-tab-inspector")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the Inspector panel active when activeTab=inspector", () => {
    renderDrawer({ activeTab: "inspector" });
    expect(screen.getByTestId("context-inspector-panel")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("context-files-panel")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("context-tab-inspector")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("context-tab-files")).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking a tab calls onTabChange — it never manages tab state itself", () => {
    const { onTabChange } = renderDrawer({ activeTab: "files" });
    fireEvent.click(screen.getByTestId("context-tab-inspector"));
    expect(onTabChange).toHaveBeenCalledWith("inspector");
    // Since the drawer is controlled, the DOM must NOT have flipped on
    // its own — it still reflects the `activeTab` prop we passed in.
    expect(screen.getByTestId("context-inspector-panel")).toHaveAttribute("data-active", "false");
  });

  it("clicking close calls onClose", () => {
    const { onClose } = renderDrawer();
    fireEvent.click(screen.getByTestId("context-drawer-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays mounted (both slots) even when closed, so state is preserved", () => {
    renderDrawer({ open: false });
    // The drawer element itself is still in the DOM...
    expect(screen.getByTestId("context-drawer")).toHaveAttribute("data-open", "false");
    // ...and both content slots are still mounted (not removed), just
    // not visible/interactive.
    expect(screen.getByTestId("files-slot")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-slot")).toBeInTheDocument();
  });

  it("re-rendering with a new activeTab prop updates the visible panel without any internal state", () => {
    const onTabChange = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <ContextDrawer
        open
        activeTab="files"
        onTabChange={onTabChange}
        onClose={onClose}
        filesContent={<div data-testid="files-slot" />}
        assetsContent={<div data-testid="assets-slot" />}
        inspectorContent={<div data-testid="inspector-slot" />}
      />,
    );
    expect(screen.getByTestId("context-files-panel")).toHaveAttribute("data-active", "true");
    rerender(
      <ContextDrawer
        open
        activeTab="inspector"
        onTabChange={onTabChange}
        onClose={onClose}
        filesContent={<div data-testid="files-slot" />}
        assetsContent={<div data-testid="assets-slot" />}
        inspectorContent={<div data-testid="inspector-slot" />}
      />,
    );
    expect(screen.getByTestId("context-inspector-panel")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("context-files-panel")).toHaveAttribute("data-active", "false");
  });
});
