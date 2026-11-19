import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import StudioEntrySkeleton, {
  StudioEntryClassicSkeleton,
} from "./StudioEntrySkeleton";

/**
 * Studio entry fix regression coverage (Larry 2026-11-18): while a
 * project is still binding, Studio must already look like the real
 * Studio — the board with its panels, chat inside its normal board
 * panel slot — never the retired centered max-w-xl standalone chat
 * (studio-board-shell-noproject).
 */
describe("StudioEntrySkeleton (board binding state)", () => {
  it("renders the board geometry with panel placeholders and no centered standalone chat", () => {
    render(<StudioEntrySkeleton />);
    expect(screen.getByTestId("studio-board-shell-binding")).toBeInTheDocument();
    expect(screen.getByTestId("studio-entry-panel-preview")).toBeInTheDocument();
    expect(screen.getByTestId("studio-entry-panel-files")).toBeInTheDocument();
    expect(screen.getByTestId("studio-entry-panel-media")).toBeInTheDocument();
    expect(screen.getByTestId("studio-entry-chat-panel")).toBeInTheDocument();
    // The retired centered-chat landing surface is gone.
    expect(
      screen.queryByTestId("studio-board-shell-noproject"),
    ).not.toBeInTheDocument();
    // The chat placeholder is NOT a max-w-xl centered column.
    const chat = screen.getByTestId("studio-entry-chat-panel");
    expect(chat.className).not.toContain("max-w-xl");
    expect(chat.className).not.toContain("mx-auto");
  });

  it("renders the real chat content inside its normal board panel slot", () => {
    render(
      <StudioEntrySkeleton
        chatContent={<div data-testid="entry-chat-content">chat</div>}
      />,
    );
    const panel = screen.getByTestId("studio-entry-chat-panel");
    expect(panel.contains(screen.getByTestId("entry-chat-content"))).toBe(true);
    // The chat panel lives inside the board area, alongside the
    // other panels' placeholders — it is not the only thing on screen.
    const board = screen.getByTestId("studio-board-shell-binding");
    expect(board.contains(panel)).toBe(true);
    expect(board.contains(screen.getByTestId("studio-entry-panel-preview"))).toBe(
      true,
    );
  });
});

describe("StudioEntryClassicSkeleton (Regular binding state)", () => {
  it("puts the chat placeholder in the classic left column, not the center", () => {
    render(<StudioEntryClassicSkeleton />);
    expect(screen.getByTestId("studio-classic-shell-binding")).toBeInTheDocument();
    const classic = screen.getByTestId("studio-classic-shell-binding");
    expect(
      classic.contains(screen.getByTestId("studio-entry-classic-chat")),
    ).toBe(true);
    expect(
      classic.contains(screen.getByTestId("studio-entry-classic-workspace")),
    ).toBe(true);
    expect(
      screen.queryByTestId("studio-board-shell-noproject"),
    ).not.toBeInTheDocument();
  });
});
