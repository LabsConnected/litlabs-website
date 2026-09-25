import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import MissionCards, { type MissionCardsProps } from "./MissionCards";
import type { ConnectionCapabilities } from "../hooks/useConnectionSummary";
import { useExecutionStore } from "../stores/useExecutionStore";

const baseCapabilities: ConnectionCapabilities = {
  repository: "none",
  repositoryName: null,
  repositoryIndexed: false,
  projectId: "proj_123",
  projectName: "Ember Roast",
  defaultBranch: "main",
  activeBranch: "main",
  sourceType: "managed",
  sourceKind: "managed",
  sourceLabel: "LiTT Managed",
  sourceStatus: "ready",
  versionControl: "git",
  githubConnected: false,
  workspaceStatus: "ready",
  githubInstalled: false,
  terminalExecution: "available",
  writeAccess: true,
  connectedProviders: [],
  availableTools: [],
  connectionSummary: "",
  terminalStatus: "disconnected",
  terminalSessionId: null,
  terminalError: null,
  terminalFailureStage: null,
  terminalCwd: null,
  terminalServerReachable: true,
  voiceTransportConnected: false,
  voiceMicrophoneOn: false,
  voiceHealth: { configured: false, tokenService: "unknown", available: false },
};

function makeProps(overrides: Partial<MissionCardsProps> = {}): MissionCardsProps {
  return {
    capabilities: baseCapabilities,
    modelLabel: "test-model",
    onOpenCode: vi.fn(),
    onOpenCanvas: vi.fn(),
    onOpenPreview: vi.fn(),
    onOpenTerminal: vi.fn(),
    onOpenActivity: vi.fn(),
    onOpenFiles: vi.fn(),
    onRollback: vi.fn(),
    ...overrides,
  };
}

describe("MissionCards", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("renders the three cards with mock props", () => {
    render(<MissionCards {...makeProps()} />);

    expect(screen.getByTestId("mission-cards")).toBeInTheDocument();
    expect(screen.getByTestId("mission-card-mission")).toBeInTheDocument();
    expect(screen.getByTestId("mission-card-checkpoints")).toBeInTheDocument();
    expect(screen.getByTestId("mission-card-actions")).toBeInTheDocument();
  });

  it("shows mission summary data from the stores", () => {
    render(<MissionCards {...makeProps()} />);

    // model label comes from props; phase "Idle" from the store's initial state
    // ("Idle" appears twice: phase badge + Status row)
    expect(screen.getByText("test-model")).toBeInTheDocument();
    expect(screen.getAllByText("Idle").length).toBeGreaterThan(0);
    expect(screen.getByText("LiTT Managed · main")).toBeInTheDocument();
  });

  it("renders the empty state when no mission exists", () => {
    const props = makeProps({
      capabilities: { ...baseCapabilities, projectId: null, projectName: null },
    });
    render(<MissionCards {...props} />);

    expect(screen.getByTestId("mission-cards")).toBeInTheDocument();
    expect(
      screen.getByText("No active mission — describe what you want to build")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("mission-card-mission")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mission-card-checkpoints")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mission-card-actions")).not.toBeInTheDocument();
  });

  it("collapse toggles hide and show the card body", () => {
    render(<MissionCards {...makeProps()} />);

    // mission card starts expanded
    expect(screen.getByTestId("mission-card-body-mission")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse Mission" }));
    expect(screen.queryByTestId("mission-card-body-mission")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Mission" }));
    expect(screen.getByTestId("mission-card-body-mission")).toBeInTheDocument();
  });

  it("checkpoints card starts collapsed with no checkpoint", () => {
    render(<MissionCards {...makeProps()} />);

    expect(screen.queryByTestId("mission-card-body-checkpoints")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No checkpoint recorded for this session.")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Checkpoints" }));
    expect(screen.getByTestId("mission-card-body-checkpoints")).toBeInTheDocument();
    expect(
      screen.getByText("No checkpoint recorded for this session.")
    ).toBeInTheDocument();
  });

  it("quick-action buttons call their handlers", () => {
    const props = makeProps();
    render(<MissionCards {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Code" }));
    expect(props.onOpenCode).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Open Canvas" }));
    expect(props.onOpenCanvas).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Open Preview" }));
    expect(props.onOpenPreview).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Open Terminal" }));
    expect(props.onOpenTerminal).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "View Activity" }));
    expect(props.onOpenActivity).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Open Files" }));
    expect(props.onOpenFiles).toHaveBeenCalledOnce();
  });

  it("shows the checkpoint with rollback action when one exists", () => {
    const props = makeProps();
    act(() => {
      useExecutionStore.getState().setCheckpoint({
        label: "pre-edit-checkpoint",
        gitSha: "abc123def456789",
      });
    });

    render(<MissionCards {...props} />);

    // card expands by default when a checkpoint exists
    expect(screen.getByTestId("mission-card-body-checkpoints")).toBeInTheDocument();
    expect(screen.getByText("pre-edit-checkpoint")).toBeInTheDocument();
    expect(screen.getByText("abc123def456")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore checkpoint" }));
    expect(props.onRollback).toHaveBeenCalledOnce();
  });

  it("disables rollback while a run is in progress", () => {
    const props = makeProps();
    act(() => {
      useExecutionStore.getState().startRun();
      useExecutionStore.getState().setCheckpoint({
        label: "pre-edit-checkpoint",
        gitSha: "abc123def456789",
      });
    });

    render(<MissionCards {...props} />);

    expect(screen.getByRole("button", { name: "Restore checkpoint" })).toBeDisabled();
    expect(screen.getByText(/step 1 in progress/i)).toBeInTheDocument();
  });

  it("shows an approval hint when approval is pending", () => {
    act(() => {
      useExecutionStore.getState().startRun();
      useExecutionStore.getState().setPendingApproval({
        toolId: "edit_file",
        reason: "File modification requires approval",
      });
    });

    render(<MissionCards {...makeProps()} />);

    expect(screen.getByText("Approval waiting")).toBeInTheDocument();
    expect(
      screen.getByText("Approval waiting — review the request before work continues.")
    ).toBeInTheDocument();
  });

  it("shows Awaiting input instead of Complete after a clarifying question", () => {
    act(() => {
      useExecutionStore.getState().setPhase("awaiting_input");
    });

    render(<MissionCards {...makeProps()} />);

    expect(screen.getAllByText("Awaiting input")).not.toHaveLength(0);
    expect(screen.queryByText("Complete")).not.toBeInTheDocument();
  });

  describe("showActions={false} (mobile Build status sheet)", () => {
    it("hides the Next Actions card but keeps Mission and Checkpoints", () => {
      render(<MissionCards {...makeProps({ showActions: false })} />);

      expect(screen.getByTestId("mission-cards")).toBeInTheDocument();
      expect(screen.getByTestId("mission-card-mission")).toBeInTheDocument();
      expect(screen.getByTestId("mission-card-checkpoints")).toBeInTheDocument();
      expect(screen.queryByTestId("mission-card-actions")).toBeNull();
    });

    it("surfaces contextual hints above the mission card", () => {
      act(() => {
        useExecutionStore.getState().startRun();
        useExecutionStore.getState().setPendingApproval({
          toolId: "edit_file",
          reason: "File modification requires approval",
        });
      });

      render(<MissionCards {...makeProps({ showActions: false })} />);

      // The hint text renders outside the actions card (which is hidden).
      expect(
        screen.getByText("Approval waiting — review the request before work continues.")
      ).toBeInTheDocument();
      expect(screen.queryByTestId("mission-card-actions")).toBeNull();
    });

    it("defaults to showing actions (desktop unchanged)", () => {
      render(<MissionCards {...makeProps()} />);
      expect(screen.getByTestId("mission-card-actions")).toBeInTheDocument();
    });
  });
});
