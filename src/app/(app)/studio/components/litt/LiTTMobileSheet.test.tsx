import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LiTTMobileSheet from "./LiTTMobileSheet";

describe("LiTTMobileSheet (real component)", () => {
  function renderSheet(overrides: Partial<Parameters<typeof LiTTMobileSheet>[0]> = {}) {
    const onTabChange = vi.fn();
    const onClose = vi.fn();
    const props = {
      activeTab: "chat" as const,
      onTabChange,
      onClose,
      chatContent: <div data-testid="chat-slot" />,
      liveContent: <div data-testid="live-slot" />,
      ...overrides,
    };
    render(<LiTTMobileSheet {...props} />);
    return { onTabChange, onClose };
  }

  beforeEach(() => {
    window.innerHeight = 844;
    const listeners: { type: string; listener: EventListenerOrEventListenerObject }[] = [];
    Object.defineProperty(window, "visualViewport", {
      value: {
        width: 390,
        height: 844,
        offsetTop: 0,
        offsetLeft: 0,
        scale: 1,
        addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
          listeners.push({ type, listener });
        },
        removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
          const idx = listeners.findIndex((l) => l.type === type && l.listener === listener);
          if (idx >= 0) listeners.splice(idx, 1);
        },
        dispatchEvent: (event: Event) => {
          listeners
            .filter((l) => l.type === event.type)
            .forEach((l) => {
              if (typeof l.listener === "function") l.listener(event);
              else l.listener.handleEvent?.(event);
            });
          return true;
        },
      },
      configurable: true,
    });
  });

  it("renders exactly one chat slot and one live slot", () => {
    renderSheet();
    expect(screen.getAllByTestId("chat-slot").length).toBe(1);
    expect(screen.getAllByTestId("live-slot").length).toBe(1);
  });

  it("shows chat active by default", () => {
    renderSheet({ activeTab: "chat" });
    expect(screen.getByTestId("litt-mobile-chat-panel")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("litt-mobile-live-panel")).toHaveAttribute("data-active", "false");
  });

  it("keeps the full-screen sheet above the keyboard with reachable chat controls", () => {
    renderSheet({
      chatContent: (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <textarea aria-label="Message input" />
          <button type="button">Send message</button>
        </div>
      ),
    });

    const sheet = screen.getByTestId("litt-mobile-sheet");
    const input = screen.getByRole("textbox", { name: "Message input" });
    input.focus();

    // Geometry is driven by the Visual Viewport API so the full-screen
    // sheet owns the whole phone height down to the safe area — the
    // bottom work-surface dock is retired (chat-first card, 2026-11-19).
    const expectedHeight = 844; // full visual viewport, no bottom nav offset
    expect(sheet).toHaveStyle({
      top: "0px",
      height: `${expectedHeight}px`,
    });
    expect(screen.getByTestId("litt-mobile-sheet-content")).toHaveClass("min-h-0", "flex-1", "overflow-hidden");
    expect(screen.getByTestId("litt-mobile-chat-panel").className).toContain("min-w-0");
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
  });

  it("lifts the sheet above the keyboard when the visual viewport shrinks", () => {
    const vv = window.visualViewport as { height: number; width: number; offsetTop: number };
    vv.height = 500;
    vv.width = 390;
    vv.offsetTop = 0;
    renderSheet();

    const sheet = screen.getByTestId("litt-mobile-sheet");
    // innerHeight 844 - visualViewport 500 => bottomInset 344,
    // bottomOffset 344, height 500 + 344 - 344 = 500.
    expect(sheet).toHaveStyle({
      top: "0px",
      height: "500px",
    });
  });

  it("anchors the sheet to the visual viewport when the browser scrolls it (offsetTop) — no gap above the keyboard", () => {
    // Android Chrome, keyboard open: the visual viewport shrinks AND
    // scrolls over the layout viewport to keep the focused composer
    // visible (offsetTop 140). Regression (Larry, 2026-11-20): a sheet
    // anchored at layout top:0 ended 140px above the visual bottom,
    // leaving a band of dimmed backdrop + workspace media cards showing
    // between the composer and the keyboard.
    const vv = window.visualViewport as { height: number; width: number; offsetTop: number };
    vv.height = 500;
    vv.width = 390;
    vv.offsetTop = 140;
    renderSheet();

    const sheet = screen.getByTestId("litt-mobile-sheet");
    expect(sheet).toHaveStyle({
      top: "140px",
      height: "500px",
    });
    // Bottom edge = 140 + 500 = 640 = offsetTop + vv.height — exactly
    // the visual viewport's bottom edge, flush above the keyboard.
  });

  it("shows sub-surface tabs and Back to chat only while a non-chat tab is open", () => {
    const { onTabChange } = renderSheet({
      activeTab: "files",
      filesContent: <div data-testid="files-slot" />,
    });
    fireEvent.click(screen.getByTestId("litt-mobile-back-to-chat"));
    expect(onTabChange).toHaveBeenCalledWith("chat");
    expect(screen.getByTestId("litt-mobile-tab-live")).toHaveTextContent("Activity");
    expect(screen.getByTestId("litt-mobile-tab-files")).toHaveTextContent("Files");
    expect(screen.getByTestId("litt-mobile-tab-components")).toHaveTextContent("Components");
  });

  it("hides the sub-surface tabs on the chat home tab", () => {
    renderSheet({ activeTab: "chat" });
    expect(screen.queryByTestId("litt-mobile-tab-live")).not.toBeInTheDocument();
    expect(screen.queryByTestId("litt-mobile-tab-files")).not.toBeInTheDocument();
    expect(screen.queryByTestId("litt-mobile-back-to-chat")).not.toBeInTheDocument();
  });

  it("shows the project name, New Chat, and menu on the chat home tab", () => {
    const onNewChat = vi.fn();
    renderSheet({ projectName: "Ember Roast", branch: "main", onNewChat, onOpenTools: vi.fn() });
    expect(screen.getByTestId("litt-mobile-project-name").textContent).toContain("Ember Roast");
    expect(screen.getByTestId("litt-mobile-project-name").textContent).toContain("main");
    fireEvent.click(screen.getByTestId("litt-mobile-new-chat"));
    expect(onNewChat).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("litt-mobile-tools-button")).toHaveAttribute("aria-label", "Menu");
  });

  it("renders the approval slot above the tabs when provided", () => {
    renderSheet({
      approvalSlot: <div data-testid="approval-card">Approve me</div>,
    });
    const slot = screen.getByTestId("litt-mobile-approval-slot");
    expect(slot).toHaveTextContent("Approve me");
    expect(slot).toContainElement(screen.getByTestId("approval-card"));
  });

  it("omits the approval slot when not provided", () => {
    renderSheet();
    expect(screen.queryByTestId("litt-mobile-approval-slot")).not.toBeInTheDocument();
  });

  it("omits the New Chat button when onNewChat is not provided", () => {
    renderSheet({ activeTab: "chat" });
    expect(screen.queryByTestId("litt-mobile-new-chat")).not.toBeInTheDocument();
  });

  describe("mobile density redesign", () => {
    it("renders the menu button and calls onOpenTools when tapped", () => {
      const onOpenTools = vi.fn();
      renderSheet({ onOpenTools });
      const toolsButton = screen.getByTestId("litt-mobile-tools-button");
      expect(toolsButton).toHaveAttribute("aria-label", "Menu");
      fireEvent.click(toolsButton);
      expect(onOpenTools).toHaveBeenCalledTimes(1);
    });

    it("omits the tools button when onOpenTools is not provided", () => {
      renderSheet();
      expect(screen.queryByTestId("litt-mobile-tools-button")).not.toBeInTheDocument();
    });

    it("renders on the light studio surface, not the old near-black sheet", () => {
      renderSheet();
      const sheet = screen.getByTestId("litt-mobile-sheet");
      expect(sheet.style.backgroundColor).toBe("var(--studio-surface)");
      expect(sheet.style.backgroundColor).not.toContain("0d0916");
    });

    it("renders no build status strip in the sheet chrome (chat-bar cleanup, 2026-11-20)", () => {
      // The "Idle LiTT · ACT" strip that sat under the project name is
      // gone — the chat screen holds nothing extra. Run status lives in
      // the Build status sheet, opened from the Tools sheet.
      renderSheet();
      expect(screen.queryByTestId("litt-mobile-build-status-slot")).not.toBeInTheDocument();
      expect(screen.queryByTestId("mobile-build-status")).not.toBeInTheDocument();
    });

    it("falls back to the LiTT label when no project name is provided", () => {
      renderSheet();
      expect(screen.getByTestId("litt-mobile-project-name").textContent).toContain("LiTT");
    });
  });
});

describe("LiTTMobileSheet — dismiss (Phase 1 #3)", () => {
  function renderDismissSheet() {
    const onClose = vi.fn();
    render(
      <LiTTMobileSheet
        activeTab="chat"
        onTabChange={vi.fn()}
        onClose={onClose}
        chatContent={<div data-testid="chat-slot" />}
        liveContent={<div data-testid="live-slot" />}
      />,
    );
    return { onClose };
  }

  it("closes on backdrop pointerdown", () => {
    const { onClose } = renderDismissSheet();
    fireEvent.pointerDown(screen.getByTestId("litt-mobile-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const { onClose } = renderDismissSheet();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on other keys", () => {
    const { onClose } = renderDismissSheet();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
