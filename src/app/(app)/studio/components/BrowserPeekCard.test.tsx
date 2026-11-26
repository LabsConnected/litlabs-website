import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import BrowserPeekCard from "./BrowserPeekCard";

// Stage one of the two-stage pop-out system (Larry, 2026-11-25):
// the peek is small, names the surface, shows the session's real
// status, and NEVER expands on its own — only the user's click on
// Open promotes it to the full dock.

vi.mock("../hooks/useBrowserSessionStatus", () => ({
  useBrowserSessionStatus: () => ({
    status: { state: "live", controller: "agent", sessionId: "s1" },
  }),
}));

describe("BrowserPeekCard", () => {
  it("renders the small peek with the live status and an explicit Open action", () => {
    render(
      <BrowserPeekCard conversationId="conv-1" onExpand={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByTestId("browser-peek-card")).toBeTruthy();
    expect(screen.getByTestId("browser-peek-status")).toHaveTextContent("Live — LiTT is working");
    expect(screen.getByTestId("browser-peek-open")).toHaveTextContent("Open the full browser");
  });

  it("Open calls onExpand (stage two) and the close control calls onClose — nothing auto-expands", () => {
    const onExpand = vi.fn();
    const onClose = vi.fn();
    render(
      <BrowserPeekCard conversationId="conv-1" onExpand={onExpand} onClose={onClose} />,
    );
    expect(onExpand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("browser-peek-open"));
    expect(onExpand).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("browser-peek-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
