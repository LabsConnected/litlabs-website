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
