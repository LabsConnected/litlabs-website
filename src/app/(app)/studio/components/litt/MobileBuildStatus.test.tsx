import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import MobileBuildStatusBar from "./MobileBuildStatus";
import { PHASE_META } from "../MissionCards";
import { useExecutionStore } from "../../stores/useExecutionStore";
import { useStudioAgentStore, AGENT_META } from "../../stores/useStudioAgentStore";

describe("MobileBuildStatusBar", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
    // useStudioAgentStore has no reset() — restore the fields this component reads.
    useStudioAgentStore.setState({ activeAgentId: "litt", executionMode: "act" });
  });

  function renderBar(props: { open?: boolean; onOpen?: () => void } = {}) {
    const onOpen = props.onOpen ?? vi.fn();
    const utils = render(
      <MobileBuildStatusBar open={props.open ?? false} onOpen={onOpen} />
    );
    return { onOpen, ...utils };
  }

  it("renders the phase label in the phase color from PHASE_META", () => {
    act(() => {
      useExecutionStore.getState().setPhase("testing");
    });
    renderBar();

    const label = screen.getByText(PHASE_META.testing.label);
    expect(label).toBeInTheDocument();
    expect(label).toHaveStyle({ color: PHASE_META.testing.color });
  });

  it("renders the agent name and uppercase execution mode", () => {
    act(() => {
      useStudioAgentStore.setState({ activeAgentId: "litt", executionMode: "auto" });
    });
    renderBar();

    const agentMeta = AGENT_META.litt;
    expect(screen.getByTestId("mobile-build-status")).toHaveTextContent(
      `${agentMeta?.displayName ?? "litt"} · AUTO`
    );
  });

  it("shows the checkpoint dot only when checkpoint.gitSha is set", () => {
    renderBar();

    expect(screen.queryByTestId("mobile-build-checkpoint-dot")).not.toBeInTheDocument();

    act(() => {
      useExecutionStore.getState().setCheckpoint({
        label: "pre-edit-checkpoint",
        gitSha: "abc123def456789",
      });
    });

    const dot = screen.getByTestId("mobile-build-checkpoint-dot");
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveAttribute("title", "Checkpoint recorded");

    act(() => {
      useExecutionStore.getState().setCheckpoint(null);
    });

    expect(screen.queryByTestId("mobile-build-checkpoint-dot")).not.toBeInTheDocument();
  });

  it("shows the Approval waiting badge only when pendingApproval is truthy", () => {
    renderBar();

    expect(screen.queryByTestId("mobile-build-approval")).not.toBeInTheDocument();
    expect(screen.queryByText("Approval waiting")).not.toBeInTheDocument();

    act(() => {
      useExecutionStore.getState().setPendingApproval({
        toolId: "edit_file",
        reason: "File modification requires approval",
      });
    });

    const badge = screen.getByTestId("mobile-build-approval");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Approval waiting");

    act(() => {
      useExecutionStore.getState().resolveApproval("approved");
    });

    expect(screen.queryByTestId("mobile-build-approval")).not.toBeInTheDocument();
  });

  it("clicking the bar calls onOpen", () => {
    const { onOpen } = renderBar();

    fireEvent.click(screen.getByTestId("mobile-build-status"));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("reflects the open prop in aria-expanded", () => {
    const { rerender } = renderBar({ open: false });
    expect(screen.getByTestId("mobile-build-status")).toHaveAttribute("aria-expanded", "false");

    rerender(<MobileBuildStatusBar open onOpen={vi.fn()} />);
    expect(screen.getByTestId("mobile-build-status")).toHaveAttribute("aria-expanded", "true");
  });
});
