import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ApprovalCard } from "./ApprovalCard";
import LiTTLiveActivity from "./LiTTLiveActivity";
import StudioOperatorBar from "./shell/StudioOperatorBar";
import { useExecutionStore } from "../stores/useExecutionStore";

/**
 * REPAIR R1b regression — the three live approval controls (Diagnosis E1
 * F1/F2).
 *
 * F2: every control must pass the CARD'S OWN pausedRunId with the decision
 * — a click must never silently bind to whatever gate happens to be
 * current in the store when the handler runs.
 * F1: every control must disable while a decision is submitting/executing —
 * not just the chat card — so duplicate decision POSTs (including a Reject
 * racing an in-flight Approve) cannot fire.
 */

// Mock Clerk to avoid provider errors (same harness as LiTTLiveActivity.test.tsx)
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <div data-testid="user-button" />,
  useUser: () => ({ user: null, isLoaded: true }),
  useAuth: () => ({ userId: null, isLoaded: true, getToken: async () => "test-token" }),
}));

// Mock WalletContext
vi.mock("@/context/WalletContext", () => ({
  useWallet: () => ({ balance: 0 }),
}));

const GATE_A = "gate-a-paused-run";

function mountGateA() {
  act(() => {
    useExecutionStore.getState().setPendingApproval({
      toolId: "files.write",
      reason: "Write requires approval",
      pausedRunId: GATE_A,
      conversationId: "conv-1",
    });
  });
}

describe("chat ApprovalCard — decision carries the card's own pausedRunId (R1b / E1 F2)", () => {
  it("Approve passes (approved, gate A) — not just the decision", () => {
    const onResolve = vi.fn();
    render(
      <ApprovalCard
        approval={{ toolId: "files.write", reason: "Write requires approval", pausedRunId: GATE_A }}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByTestId("approval-approve"));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith("approved", GATE_A);
  });

  it("Deny passes (rejected, gate A)", () => {
    const onResolve = vi.fn();
    render(
      <ApprovalCard
        approval={{ toolId: "files.write", reason: "Write requires approval", pausedRunId: GATE_A }}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByTestId("approval-deny"));
    expect(onResolve).toHaveBeenCalledWith("rejected", GATE_A);
  });
});

describe("LiTTLiveActivity approval card — binding + phase disabling (R1b / E1 F1+F2)", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("Approve passes the card's pausedRunId with the decision", () => {
    mountGateA();
    const onResolveApproval = vi.fn();
    render(<LiTTLiveActivity onResolveApproval={onResolveApproval} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onResolveApproval).toHaveBeenCalledTimes(1);
    expect(onResolveApproval).toHaveBeenCalledWith("approved", GATE_A);
  });

  it("buttons disable while a decision is submitting — a racing Reject cannot fire", () => {
    mountGateA();
    const onResolveApproval = vi.fn();
    render(<LiTTLiveActivity onResolveApproval={onResolveApproval} />);
    act(() => {
      useExecutionStore.getState().beginApprovalSubmit();
    });
    const approve = screen.getByRole("button", { name: "Approve" });
    const reject = screen.getByRole("button", { name: "Reject" });
    expect(approve).toBeDisabled();
    expect(reject).toBeDisabled();
    fireEvent.click(reject);
    expect(onResolveApproval).not.toHaveBeenCalled();
  });
});

describe("StudioOperatorBar approval buttons — binding + phase disabling (R1b / E1 F1+F2)", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("Approve passes the gate's pausedRunId with the decision", () => {
    mountGateA();
    const onResolveApproval = vi.fn();
    render(<StudioOperatorBar onResolveApproval={onResolveApproval} />);
    fireEvent.click(screen.getByLabelText("Approve"));
    expect(onResolveApproval).toHaveBeenCalledTimes(1);
    expect(onResolveApproval).toHaveBeenCalledWith("approved", GATE_A);
  });

  it("buttons disable while the resumed run is executing", () => {
    mountGateA();
    const onResolveApproval = vi.fn();
    render(<StudioOperatorBar onResolveApproval={onResolveApproval} />);
    act(() => {
      useExecutionStore.getState().beginApprovalSubmit();
      useExecutionStore.getState().approvalAccepted();
    });
    expect(useExecutionStore.getState().approvalPhase).toBe("executing");
    expect(screen.getByLabelText("Approve")).toBeDisabled();
    expect(screen.getByLabelText("Reject")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Reject"));
    expect(onResolveApproval).not.toHaveBeenCalled();
  });
});
