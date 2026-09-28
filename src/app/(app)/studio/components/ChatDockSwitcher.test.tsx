import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import ChatDockSwitcher from "./ChatDockSwitcher";

describe("ChatDockSwitcher", () => {
  it("renders left and bottom dock buttons", () => {
    render(<ChatDockSwitcher position="left" onChange={() => {}} />);
    expect(screen.getByTestId("chat-dock-left")).toBeTruthy();
    expect(screen.getByTestId("chat-dock-bottom")).toBeTruthy();
  });

  it("marks the active position with aria-pressed", () => {
    const { rerender } = render(<ChatDockSwitcher position="left" onChange={() => {}} />);
    expect(screen.getByTestId("chat-dock-left").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("chat-dock-bottom").getAttribute("aria-pressed")).toBe("false");
    rerender(<ChatDockSwitcher position="bottom" onChange={() => {}} />);
    expect(screen.getByTestId("chat-dock-bottom").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("chat-dock-left").getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onChange with the tapped position", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ChatDockSwitcher position="left" onChange={onChange} />);
    await user.click(screen.getByTestId("chat-dock-bottom"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("bottom");
  });
});
