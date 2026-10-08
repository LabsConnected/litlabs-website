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

  it("labels the tabs Chat | Activity (tab ids unchanged)", () => {
    renderPanel();
    expect(screen.getByTestId("litt-tab-chat")).toHaveTextContent("Chat");
    expect(screen.getByTestId("litt-tab-live")).toHaveTextContent("Activity");
  });
});

describe("LiTTPanel — F1 overlay mode (slice B)", () => {
  function renderOverlay(overrides: Partial<Parameters<typeof LiTTPanel>[0]> = {}) {
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
      overlay: true,
      ...overrides,
    };
    render(<LiTTPanel {...props} />);
    return { onTabChange, onCollapse, onExpand };
  }

  it("renders as a floating panel (fixed position, right side, elevated)", () => {
    renderOverlay();
    const panel = screen.getByTestId("litt-panel");
    expect(panel).toHaveAttribute("data-overlay", "true");
    // Fixed positioning comes from Tailwind classes (jsdom doesn't resolve
    // classes — assert the class, and the inline geometry via style).
    expect(panel.className).toContain("fixed");
    expect(panel.className).toContain("z-[70]");
    expect(panel.className).toContain("rounded-2xl");
    expect(panel).toHaveStyle({ right: "12px", display: "flex" });
    // Elevated shadow, not a layout column.
    expect(panel.style.boxShadow.length).toBeGreaterThan(0);
    expect(panel.className).not.toContain("border-r");
  });

  it("shows a close button (not the docked collapse button) that calls onCollapse", () => {
    const { onCollapse } = renderOverlay();
    expect(screen.getByTestId("litt-panel-close")).toBeInTheDocument();
    expect(screen.queryByTestId("litt-panel-collapse")).toBeNull();
    fireEvent.click(screen.getByTestId("litt-panel-close"));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("closed overlay hides with display:none but keeps chat content mounted", () => {
    renderOverlay({ collapsed: true });
    const panel = screen.getByTestId("litt-panel");
    expect(panel).toHaveStyle({ display: "none" });
    // SSE/scroll/drafts survive: content stays in the DOM.
    expect(screen.getByTestId("chat-slot")).toBeInTheDocument();
    expect(screen.getByTestId("live-slot")).toBeInTheDocument();
  });

  it("overlay width is clamped to fit a 390px viewport", () => {
    renderOverlay({ expandedWidth: 480 });
    const panel = screen.getByTestId("litt-panel");
    // min(480px, 100vw-24px) — never wider than the viewport minus margin.
    expect(panel.style.width).toContain("calc(100vw - 24px)");
  });

  it("overlay renders the chat slot with no duplicate composer", () => {
    renderOverlay();
    expect(screen.getByTestId("chat-slot")).toBeInTheDocument();
    expect(screen.queryByTestId("studio-command-composer")).toBeNull();
  });

  it("renders the canonical BrandLogo mark in the header (no invented L tile)", () => {
    renderOverlay();
    const brand = screen.getByTestId("litt-panel-brand");
    const logo = brand.querySelector('img[alt="LiTT logo"]');
    expect(logo).not.toBeNull();
    expect(logo?.getAttribute("src")).toContain("icon-192.png");
    // The old gradient "L" tile is gone.
    expect(brand.textContent).not.toMatch(/^L$/);
  });

  it("docked mode is unchanged: collapse button, no close button, no overlay flag", () => {
    const { onCollapse } = (function () {
      const onTabChange = vi.fn();
      const onCollapse = vi.fn();
      const onExpand = vi.fn();
      render(
        <LiTTPanel
          chatContent={<div data-testid="chat-slot" />}
          liveContent={<div data-testid="live-slot" />}
          activeTab="chat"
          onTabChange={onTabChange}
          collapsed={false}
          onCollapse={onCollapse}
          onExpand={onExpand}
        />,
      );
      return { onCollapse };
    })();
    const panel = screen.getByTestId("litt-panel");
    expect(panel).toHaveAttribute("data-overlay", "false");
    expect(screen.getByTestId("litt-panel-collapse")).toBeInTheDocument();
    expect(screen.queryByTestId("litt-panel-close")).toBeNull();
    fireEvent.click(screen.getByTestId("litt-panel-collapse"));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
