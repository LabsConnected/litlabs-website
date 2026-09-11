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

  it("keeps the bounded sheet above the mobile nav with reachable chat controls", () => {
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

    // Geometry is driven by the Visual Viewport API so the sheet stays
    // above the 62px bottom nav and any on-screen keyboard.
    const expectedHeight = Math.min(Math.round(844 * 0.88), 844 - 62); // 742
    expect(sheet).toHaveStyle({
      bottom: "62px",
      height: `${expectedHeight}px`,
    });
    expect(sheet.getAttribute("style")).toContain("max-height");
    expect(sheet.getAttribute("style")).toContain("var(--studio-mobile-bottom-h)");
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
    const expectedHeight = Math.min(Math.round(500 * 0.88), 500 - 62); // 438
    expect(sheet).toHaveStyle({
      bottom: "406px", // 62 + (844 - 500)
      height: `${expectedHeight}px`,
    });
  });

  it("clicking Live calls onTabChange without managing its own state", () => {
    const { onTabChange } = renderSheet({ activeTab: "chat" });
    fireEvent.click(screen.getByTestId("litt-mobile-tab-live"));
    expect(onTabChange).toHaveBeenCalledWith("live");
    expect(screen.getByTestId("litt-mobile-live-panel")).toHaveAttribute("data-active", "false");
  });

  it("clicking close calls onClose", () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByTestId("litt-mobile-sheet-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
