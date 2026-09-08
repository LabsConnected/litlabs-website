import { describe, it, expect, vi } from "vitest";
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

    expect(sheet).toHaveStyle({
      bottom: "calc(62px + env(safe-area-inset-bottom))",
      height: "min(88dvh, calc(100dvh - 62px - env(safe-area-inset-bottom)))",
      maxHeight: "calc(100dvh - 62px - env(safe-area-inset-bottom))",
    });
    expect(screen.getByTestId("litt-mobile-sheet-content")).toHaveClass("min-h-0", "flex-1", "overflow-hidden");
    expect(screen.getByTestId("litt-mobile-chat-panel").className).toContain("min-w-0");
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
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
