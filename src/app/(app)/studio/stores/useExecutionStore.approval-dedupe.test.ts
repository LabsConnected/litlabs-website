import { describe, it, expect, beforeEach } from "vitest";

import {
  useExecutionStore,
  feedSSEEventToExecutionStore,
} from "./useExecutionStore";

function approvalEntries() {
  return useExecutionStore
    .getState()
    .events.filter((e) => e.type === "approval_required");
}

describe("useExecutionStore approval-entry dedupe", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("dedupes a re-fired approval_required SSE signal for the same tool", () => {
    feedSSEEventToExecutionStore({ type: "approval_required", toolId: "files_write" });
    feedSSEEventToExecutionStore({ type: "approval_required", toolId: "files_write" });
    feedSSEEventToExecutionStore({ type: "approval_required", toolId: "files_write" });
    expect(approvalEntries()).toHaveLength(1);
  });

  it("claims the SSE entry in place when pending_approval follows (no duplicate)", () => {
    feedSSEEventToExecutionStore({ type: "approval_required", toolId: "files_write" });
    feedSSEEventToExecutionStore({
      type: "pending_approval",
      toolId: "files_write",
      pausedRunId: "gate-1",
    });
    const entries = approvalEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].gateId).toBe("gate-1");
    // The gate is still pending in state.
    expect(useExecutionStore.getState().pendingApproval?.pausedRunId).toBe("gate-1");
  });

  it("dedupes a repeated pending_approval for the same gate", () => {
    const approval = { toolId: "files_write", reason: "Approval required", pausedRunId: "gate-2" };
    useExecutionStore.getState().setPendingApproval(approval);
    useExecutionStore.getState().setPendingApproval(approval);
    expect(approvalEntries()).toHaveLength(1);
  });

  it("logs a fresh entry for the next gate after the previous one resolves", () => {
    useExecutionStore.getState().setPendingApproval({
      toolId: "files_write",
      reason: "Approval required",
      pausedRunId: "gate-3",
    });
    useExecutionStore.getState().resolveApproval("approved");
    useExecutionStore.getState().setPendingApproval({
      toolId: "files_write",
      reason: "Approval required",
      pausedRunId: "gate-4",
    });
    expect(approvalEntries()).toHaveLength(2);
  });

  it("keeps separate entries for different tools", () => {
    feedSSEEventToExecutionStore({ type: "approval_required", toolId: "files_write" });
    feedSSEEventToExecutionStore({ type: "approval_required", toolId: "image_generate" });
    expect(approvalEntries()).toHaveLength(2);
  });
});
