import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import ChatJobsView from "./ChatJobsView";

// ChatJobsView mounts these three real feeds; stub them here so this
// suite pins the view's WIRING (which feed, which props) — each feed's
// own internals are covered by its own suite. Same stub pattern as the
// board suite (BoardPanels.test.tsx), which pins the same component
// through BoardChatPanel.
vi.mock("./StudioHealthPanel", () => ({
  default: (props: { mode: string; projectId: string | null; conversationId?: string | null }) => (
    <div
      data-testid="jobs-approvals-stub"
      data-mode={props.mode}
      data-project={props.projectId ?? ""}
      data-conversation={props.conversationId ?? ""}
    />
  ),
}));
vi.mock("./RunChangesPanel", () => ({
  default: (props: { projectId: string | null }) => (
    <div data-testid="jobs-changes-stub" data-project={props.projectId ?? ""} />
  ),
}));
vi.mock("./ActionRunStatusPanel", () => ({
  ActionRunStatusPanel: (props: { conversationId: string }) => (
    <div data-testid="jobs-live-steps-stub" data-conversation={props.conversationId} />
  ),
}));
import { useExecutionStore, type ExecutionEvent } from "../stores/useExecutionStore";

function wrap(node: React.ReactNode) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

function executionEvent(id: string, summary: string, extra: Partial<ExecutionEvent> = {}): ExecutionEvent {
  return { id, seq: Number(id.replace(/\D/g, "")) || 1, type: "tool_result", summary, ...extra } as ExecutionEvent;
}

beforeEach(() => {
  useExecutionStore.setState({
    phase: "idle",
    isRunning: false,
    events: [],
    checkpoint: null,
    pendingApproval: null,
  });
});

describe("ChatJobsView (shared Jobs tab body — Board + Regular)", () => {
  it("shows honest empty states when no project or conversation is in scope", () => {
    wrap(<ChatJobsView />);
    expect(screen.getByTestId("board-chat-jobs")).toBeInTheDocument();
    // Plan / work log / checks summaries are present but empty-honest.
    expect(screen.getByTestId("board-chat-jobs-plan")).toHaveTextContent("No plan yet");
    expect(screen.getByTestId("board-chat-jobs-worklog")).toHaveTextContent("No work logged yet");
    expect(screen.getByTestId("board-chat-jobs-checks")).toHaveTextContent(
      "No checks have run for this conversation yet.",
    );
    // No conversation → the live-steps empty note, never the strip.
    expect(screen.getByTestId("board-chat-jobs-live-steps-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("jobs-live-steps-stub")).toBeNull();
    // No project → approvals/changes stay unmounted with honest notes.
    expect(screen.getByTestId("board-chat-jobs-approvals")).toHaveTextContent(
      "Approvals appear here once a project is open.",
    );
    expect(screen.queryByTestId("jobs-approvals-stub")).toBeNull();
    expect(screen.getByTestId("board-chat-jobs-changes")).toHaveTextContent(
      "Changes appear here once a project is open.",
    );
    expect(screen.queryByTestId("jobs-changes-stub")).toBeNull();
    // No checks summon without a handler.
    expect(screen.queryByTestId("board-chat-jobs-open-checks")).toBeNull();
  });

  it("mounts the run-status strip ONLY here, fed by the conversation in scope", () => {
    wrap(<ChatJobsView projectId="project-1" conversationId="conv-1" />);
    const liveSteps = screen.getByTestId("board-chat-jobs-live-steps");
    expect(liveSteps).toBeInTheDocument();
    const strip = screen.getByTestId("jobs-live-steps-stub");
    expect(strip).toHaveAttribute("data-conversation", "conv-1");
    expect(liveSteps.contains(strip)).toBe(true);
    expect(screen.queryByTestId("board-chat-jobs-live-steps-empty")).toBeNull();
  });

  it("wires the approvals queue and run changes to the project in scope", () => {
    wrap(<ChatJobsView projectId="project-1" conversationId="conv-1" />);
    const approvals = screen.getByTestId("jobs-approvals-stub");
    expect(approvals).toHaveAttribute("data-mode", "approvals");
    expect(approvals).toHaveAttribute("data-project", "project-1");
    expect(approvals).toHaveAttribute("data-conversation", "conv-1");
    expect(screen.getByTestId("jobs-changes-stub")).toHaveAttribute("data-project", "project-1");
  });

  it("renders plan steps, the checks summary and a pending approval from real store state", () => {
    useExecutionStore.setState({
      phase: "editing",
      isRunning: true,
      events: [
        executionEvent("e1", "Draft the landing page"),
        executionEvent("e2", "Typecheck the project", {
          type: "build_result",
          check: "typecheck",
          success: false,
          errorCount: 2,
        }),
      ],
      pendingApproval: { toolId: "deploy", reason: "Needs a human review" },
    });
    wrap(<ChatJobsView projectId="project-1" conversationId="conv-1" />);
    expect(screen.getByTestId("board-chat-jobs-plan")).toHaveTextContent("Draft the landing page");
    expect(screen.getByTestId("board-chat-jobs-checks")).toHaveTextContent("typecheck — 2 errors");
    expect(screen.getByTestId("board-chat-jobs-worklog")).toHaveTextContent("Draft the landing page");
    const pending = screen.getByTestId("board-chat-jobs-pending-approval");
    expect(pending).toHaveTextContent("Approval waiting in chat: deploy — Needs a human review");
  });

  it("the Open Checks button summons the layout's Checks surface", () => {
    const onOpenChecks = vi.fn();
    wrap(<ChatJobsView onOpenChecks={onOpenChecks} />);
    fireEvent.click(screen.getByTestId("board-chat-jobs-open-checks"));
    expect(onOpenChecks).toHaveBeenCalledTimes(1);
  });
});
