import { describe, it, expect } from "vitest";
import { approvalAwaitingDecision } from "../lib/approval-awaiting";
import type { PendingApproval } from "./useExecutionStore";

// Approve-in-chat (2026-11-11): every status surface (header pill, Mission
// cards, mobile build bar, ambient HUD) used to derive "Approval needed /
// waiting" from pendingApproval presence alone. But the store KEEPS
// pendingApproval mounted through submitting/executing so the chat card can
// show "Approved — running..." — the same screen then claimed both states
// at once. This helper is the single derivation they all share now: a gate
// awaits a decision only while no decision is in flight or executing.
const gate: PendingApproval = {
  toolId: "image.stock",
  reason: "Mutation requires approval in ACT mode",
  pausedRunId: "paused-1",
};

describe("approvalAwaitingDecision", () => {
  it("is false when no gate is mounted", () => {
    expect(approvalAwaitingDecision(null, "idle")).toBe(false);
    expect(approvalAwaitingDecision(undefined, "idle")).toBe(false);
  });

  it("is true while the gate waits for the user's decision", () => {
    expect(approvalAwaitingDecision(gate, "idle")).toBe(true);
  });

  it("stays true when a decision attempt FAILED and the gate is still actionable", () => {
    expect(approvalAwaitingDecision(gate, "failed")).toBe(true);
  });

  it("is false while the decision is being submitted", () => {
    expect(approvalAwaitingDecision(gate, "submitting")).toBe(false);
  });

  it("is false while the resumed run executes after approval", () => {
    expect(approvalAwaitingDecision(gate, "executing")).toBe(false);
  });
});
