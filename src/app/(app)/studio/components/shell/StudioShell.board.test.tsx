import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import StudioShell from "./StudioShell";

/**
 * Board-mode shell contract (plan §2 B2): with no board props the shell
 * is the fixed stage layout, unchanged; with the board active the board
 * replaces the stage area; the toolbar toggle flips between them.
 */

function renderShell(extra: Partial<Parameters<typeof StudioShell>[0]> = {}) {
  return render(
    <StudioShell
      taskbar={<div>taskbar</div>}
      rail={<div>rail</div>}
      stage={<div>fixed stage</div>}
      inspector={<div>inspector</div>}
      inspectorOpen={false}
      onOpenInspector={() => {}}
      leftWidth={320}
      onResetLeftWidth={() => {}}
      {...extra}
    />,
  );
}

describe("StudioShell board integration", () => {
  it("without board props there is no board toggle and the stage renders", () => {
    renderShell();
    expect(screen.queryByTestId("dock-board-toggle")).toBeNull();
    expect(screen.getByText("fixed stage")).toBeInTheDocument();
  });

  it("board inactive: the stage renders and the toggle offers Board mode", () => {
    const onToggleBoard = vi.fn();
    renderShell({
      board: <div>the board</div>,
      boardActive: false,
      onToggleBoard,
    });
    expect(screen.getByText("fixed stage")).toBeInTheDocument();
    expect(screen.queryByText("the board")).toBeNull();
    const toggle = screen.getByTestId("dock-board-toggle");
    expect(toggle).toHaveTextContent("Board mode");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(onToggleBoard).toHaveBeenCalledTimes(1);
  });

  it("board active: the board replaces the stage area", () => {
    renderShell({
      board: <div>the board</div>,
      boardActive: true,
      onToggleBoard: () => {},
    });
    expect(screen.getByText("the board")).toBeInTheDocument();
    expect(screen.queryByText("fixed stage")).toBeNull();
    expect(screen.getByTestId("dock-board-toggle")).toHaveTextContent("Stage layout");
  });
});
