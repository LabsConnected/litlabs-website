import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LiTTPanel from "./LiTTPanel";

/**
 * Focused, unmocked tests for LiTTPanel (Phase C2.1).
 *
 * Covers the state-preservation bug the previous C2 report missed:
 * CommandStudio used to swap between LiTTAmbientHUD and LiTTPanel with a
 * ternary, unmounting chatContent/liveContent on every collapse. LiTTPanel
 * is now a single persistent container — collapsing must hide, not
 * unmount, the chat/live content.
 */
describe("LiTTPanel (real component)", () => {
  function renderPanel(overrides: Partial<Parameters<typeof LiTTPanel>[0]> = {}) {
    const onTabChange = vi.fn();
    const onCollapse = vi.fn();
    const onExpand = vi.fn();
    const props = {
      chatContent: <div data-testid="chat-slot">Chat content</div>,
      liveContent: <div data-testid="live-slot">Live content</div>,
      activeTab: "chat" as const,
      onTabChange,
      collapsed: false,
      onCollapse,
      onExpand,
      ...overrides,
    };
    render(<LiTTPanel {...props} />);
    return { onTabChange, onCollapse, onExpand };
  }

  it("renders expanded chrome and hides collapsed chrome when collapsed=false", () => {
    renderPanel({ collapsed: false });
    expect(screen.getByTestId("litt-panel-expanded-chrome")).toHaveStyle({ display: "flex" });
    expect(screen.getByTestId("litt-panel-collapsed-chrome")).toHaveStyle({ display: "none" });
    expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "false");
  });

  it("renders collapsed chrome and hides expanded chrome when collapsed=true, but keeps content mounted", () => {
    renderPanel({ collapsed: true });
    expect(screen.getByTestId("litt-panel-collapsed-chrome")).toHaveStyle({ display: "flex" });
    expect(screen.getByTestId("litt-panel-expanded-chrome")).toHaveStyle({ display: "none" });
    expect(screen.getByTestId("litt-panel")).toHaveAttribute("data-collapsed", "true");
    // The chat content is still in the DOM — not unmounted.
    expect(screen.getByTestId("chat-slot")).toBeInTheDocument();
  });

  it("collapsing via rerender does not unmount chat/live content", () => {
    const props = {
      chatContent: <div data-testid="chat-slot">Chat content</div>,
      liveContent: <div data-testid="live-slot">Live content</div>,
      activeTab: "chat" as const,
      onTabChange: vi.fn(),
      onCollapse: vi.fn(),
      onExpand: vi.fn(),
    };
    const { rerender } = render(<LiTTPanel {...props} collapsed={false} />);
    const chatNodeBeforeCollapse = screen.getByTestId("chat-slot");
    rerender(<LiTTPanel {...props} collapsed={true} />);
    const chatNodeAfterCollapse = screen.getByTestId("chat-slot");
    // Same DOM node reference — proves React did not unmount/remount it.
    expect(chatNodeAfterCollapse).toBe(chatNodeBeforeCollapse);
  });

  it("clicking collapse calls onCollapse, not an internal toggle", () => {
    const { onCollapse } = renderPanel({ collapsed: false });
    fireEvent.click(screen.getByTestId("litt-panel-collapse"));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("clicking expand (from the collapsed HUD) calls onExpand", () => {
    const { onExpand } = renderPanel({ collapsed: true });
    fireEvent.click(screen.getByTestId("litt-hud-expand"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("active tab is fully controlled — clicking Live calls onTabChange, does not flip internal state", () => {
    const { onTabChange } = renderPanel({ activeTab: "chat" });
    fireEvent.click(screen.getByTestId("litt-tab-live"));
    expect(onTabChange).toHaveBeenCalledWith("live");
    // Still shows Chat as active because the prop hasn't changed —
    // proves there's no internal state overriding the parent.
    expect(screen.getByTestId("litt-chat-panel")).toHaveAttribute("data-active", "true");
  });

  it("rerendering with a new activeTab prop switches the visible tab", () => {
    const props = {
      chatContent: <div data-testid="chat-slot" />,
      liveContent: <div data-testid="live-slot" />,
      onTabChange: vi.fn(),
      collapsed: false,
      onCollapse: vi.fn(),
      onExpand: vi.fn(),
    };
    const { rerender } = render(<LiTTPanel {...props} activeTab="chat" />);
    expect(screen.getByTestId("litt-chat-panel")).toHaveAttribute("data-active", "true");
    rerender(<LiTTPanel {...props} activeTab="live" />);
    expect(screen.getByTestId("litt-live-panel")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("litt-chat-panel")).toHaveAttribute("data-active", "false");
  });

  it("only ever renders a single chat slot and a single live slot", () => {
    renderPanel();
    expect(screen.getAllByTestId("chat-slot").length).toBe(1);
    expect(screen.getAllByTestId("live-slot").length).toBe(1);
  });
});
