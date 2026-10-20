import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import MissionCards, { type MissionCardsProps } from "./MissionCards";
import type { ConnectionCapabilities } from "../hooks/useConnectionSummary";
import { useExecutionStore } from "../stores/useExecutionStore";

/**
 * Regression tests — the mission approval hint keys off gate phase +
 * terminal state, not pendingApproval presence (Repair R4, E3-S2).
 *
 * The defect: MissionCards rendered "Approval waiting" whenever a
 * pendingApproval object existed in the store — approvalPhase was never
 * consulted — so while a decision was already in flight (submitting /
 * executing) or after the run had terminated around a kept gate, the
 * mission panel kept announcing a live gate. Combined with the missing
 * cancelled outcome in the polling contract, a cancelled run's mission
 * card said "Approval needed" forever.
 */

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

function makeProps(): MissionCardsProps {
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
  };
}

function mountGate() {
  useExecutionStore.getState().setPendingApproval({
    toolId: "files.write",
    reason: "Mutation requires approval in ACT mode",
    pausedRunId: "gate-1",
    conversationId: "conv-1",
  });
}

describe("MissionCards — approval hint keying (R4/E3-S2)", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("anchor: a gate genuinely awaiting a decision shows 'Approval waiting'", () => {
    mountGate();
    render(<MissionCards {...makeProps()} />);
    expect(screen.getAllByText(/Approval waiting/).length).toBeGreaterThan(0);
  });

  it("while the decision is in flight (executing), the mission no longer claims the approval is waiting", () => {
    mountGate();
    const exec = useExecutionStore.getState();
    exec.beginApprovalSubmit();
    exec.approvalAccepted();
    expect(useExecutionStore.getState().approvalPhase).toBe("executing");

    render(<MissionCards {...makeProps()} />);
    expect(screen.queryByText(/Approval waiting/)).not.toBeInTheDocument();
  });

  it("after the run's cancelled outcome clears the gate, no approval hint remains", () => {
    mountGate();
    useExecutionStore.getState().resolveApproval("cancelled", { pausedRunId: "gate-1" });

    render(<MissionCards {...makeProps()} />);
    expect(screen.queryByText(/Approval waiting/)).not.toBeInTheDocument();
  });
});
