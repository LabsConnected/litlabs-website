import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import ChatDockSwitcher, { type ChatDockPosition } from "./ChatDockSwitcher";

function renderSwitcher(position: ChatDockPosition, onChange: (p: ChatDockPosition) => void) {
  return render(<ChatDockSwitcher position={position} onChange={onChange} />);
}

describe("ChatDockSwitcher", () => {
  it("renders left and bottom dock buttons", () => {
    renderSwitcher("left", vi.fn());
    expect(screen.getByTestId("chat-dock-switcher")).toBeTruthy();
    expect(screen.getByTestId("chat-dock-left")).toHaveTextContent("Left");
    expect(screen.getByTestId("chat-dock-bottom")).toHaveTextContent("Bottom");
  });

  it("marks the active position with aria-pressed", () => {
    const { rerender } = renderSwitcher("left", vi.fn());
    expect(screen.getByTestId("chat-dock-left")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("chat-dock-bottom")).toHaveAttribute("aria-pressed", "false");
    rerender(<ChatDockSwitcher position="bottom" onChange={vi.fn()} />);
    expect(screen.getByTestId("chat-dock-left")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("chat-dock-bottom")).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onChange with the picked position when a different button is clicked", () => {
    const onChange = vi.fn();
    renderSwitcher("left", onChange);
    fireEvent.click(screen.getByTestId("chat-dock-bottom"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("bottom");
    // Clicking the already-active button is a no-op.
    fireEvent.click(screen.getByTestId("chat-dock-left"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
