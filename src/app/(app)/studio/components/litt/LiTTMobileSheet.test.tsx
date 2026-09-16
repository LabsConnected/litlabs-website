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

  it("keeps the full-screen sheet above the mobile nav with reachable chat controls", () => {
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
    // sheet stays above the 62px bottom nav and any on-screen keyboard.
    const expectedHeight = 844 - 62; // 782
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
    // bottomOffset 62 + 344 = 406, height 500 + 344 - 406 = 438.
    expect(sheet).toHaveStyle({
      top: "0px",
      height: "438px",
    });
  });

  it("clicking Live calls onTabChange without managing its own state", () => {
    const { onTabChange } = renderSheet({ activeTab: "chat" });
    fireEvent.click(screen.getByTestId("litt-mobile-tab-live"));
    expect(onTabChange).toHaveBeenCalledWith("live");
    expect(screen.getByTestId("litt-mobile-live-panel")).toHaveAttribute("data-active", "false");
  });

  it("labels the tabs Chat | Activity", () => {
    renderSheet();
    expect(screen.getByTestId("litt-mobile-tab-chat")).toHaveTextContent("Chat");
    expect(screen.getByTestId("litt-mobile-tab-live")).toHaveTextContent("Activity");
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

  it("clicking close calls onClose", () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByTestId("litt-mobile-sheet-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("mobile density redesign", () => {
    it("renders the tools button and calls onOpenTools when tapped", () => {
      const onOpenTools = vi.fn();
      renderSheet({ onOpenTools });
      const toolsButton = screen.getByTestId("litt-mobile-tools-button");
      expect(toolsButton).toHaveAttribute("aria-label", "Open tools");
      fireEvent.click(toolsButton);
      expect(onOpenTools).toHaveBeenCalledTimes(1);
    });

    it("omits the tools button when onOpenTools is not provided", () => {
      renderSheet();
      expect(screen.queryByTestId("litt-mobile-tools-button")).not.toBeInTheDocument();
    });

    it("renders the slim project/branch context row when provided", () => {
      renderSheet({ projectName: "Ember Roast", branch: "main" });
      const context = screen.getByTestId("litt-mobile-context");
      expect(context.textContent).toContain("Ember Roast");
      expect(context.textContent).toContain("main");
    });

    it("omits the context row when no project or branch is provided", () => {
      renderSheet();
      expect(screen.queryByTestId("litt-mobile-context")).not.toBeInTheDocument();
    });
  });
});
