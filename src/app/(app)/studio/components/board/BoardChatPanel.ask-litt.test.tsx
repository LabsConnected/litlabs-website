import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import BoardChatPanel from "./BoardChatPanel";

// The Jobs tab mounts these feeds; stub them so this suite pins the
// panel's own tab behavior only (same stubs as BoardPanels.test.tsx).
vi.mock("../StudioHealthPanel", () => ({
  default: () => <div data-testid="jobs-approvals-stub" />,
}));
vi.mock("../RunChangesPanel", () => ({
  default: () => <div data-testid="jobs-changes-stub" />,
}));
vi.mock("../ActionRunStatusPanel", () => ({
  ActionRunStatusPanel: () => <div data-testid="jobs-live-steps-stub" />,
}));

/**
 * ACC-01 F8b: the Deploy surface's "Redeploy with LiTT" click chains
 * through studio:ask-litt, which pre-fills this panel's composer. The
 * composer only renders on the Chat tab — with the user sitting on the
 * Jobs tab, the request was invisible and the click read as a dead
 * button. An ask-litt event must land the panel on the Chat tab.
 */
describe("BoardChatPanel — ask-litt lands on the Chat tab (ACC-01 F8b)", () => {
  const chatProps = {
    projectName: "Test Project",
    transcript: <div data-testid="transcript-stub" />,
    composer: <div data-testid="composer-stub" />,
    onNewChat: vi.fn(),
    onOpenPreview: vi.fn(),
    onOpenFiles: vi.fn(),
  };

  it("switches from Jobs back to Chat when an ask-litt request arrives", () => {
    render(
      <ThemeProvider>
        <BoardChatPanel {...chatProps} />
      </ThemeProvider>,
    );

    // The user is on the Jobs tab: the composer (and its pre-filled
    // deploy request) is not rendered at all.
    fireEvent.click(screen.getByTestId("board-chat-tab-jobs"));
    expect(screen.getByTestId("board-chat-tab-jobs")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("composer-stub")).toBeNull();

    // The Deploy surface's click arrives as an ask-litt event.
    fireEvent(
      window,
      new CustomEvent("studio:ask-litt", {
        detail: { prompt: "Deploy this project to production" },
      }),
    );

    // The panel lands on Chat, where the request actually is.
    expect(screen.getByTestId("board-chat-tab-chat")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("composer-stub")).toBeInTheDocument();
  });
});
