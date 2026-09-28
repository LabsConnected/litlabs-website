import { describe, it, expect, beforeEach } from "vitest";

import {
  useExecutionStore,
  feedSSEEventToExecutionStore,
} from "./useExecutionStore";

/**
 * Regression test for the #551 acceptance failure (2026-09-28): after an
 * approved run failed at the tool step, the runtime showed "FAILED" while
 * the operator status bar kept showing "Waiting for approval" with live
 * Approve/Reject buttons — a hung approval state with no live gate.
 *
 * The dead StudioOperatorBar that rendered that strip is deleted; this
 * test pins the store invariants so approval state can never hang that
 * way again:
 *  1. A failed "finished" clears any stale gate — phase is "failed",
 *     never "awaiting_approval".
 *  2. A gate that reached a decision never re-arms from a late/duplicate
 *     pending_approval for the same pausedRunId.
 *  3. endRun("failed") clears a pending gate as a terminal outcome.
 *
 * The approval state machine itself is untouched — this test only drives
 * it through the observed failure sequence and asserts the outcomes.
 */
describe("useExecutionStore approval-hang regression", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("clears a stale gate and reports failed (not awaiting_approval) when the approved run fails", () => {
    // approval_required → pending_approval → user approves
    feedSSEEventToExecutionStore({ type: "approval_required", toolId: "files_write" });
    feedSSEEventToExecutionStore({
      type: "pending_approval",
      toolId: "files_write",
      pausedRunId: "gate-hang-1",
    });
    expect(useExecutionStore.getState().pendingApproval?.pausedRunId).toBe("gate-hang-1");
    expect(useExecutionStore.getState().phase).toBe("awaiting_approval");

    useExecutionStore.getState().resolveApproval("approved");
    expect(useExecutionStore.getState().pendingApproval).toBeNull();

    // The tool then fails and the run emits finished success:false —
    // no approval gate may be left hanging.
    feedSSEEventToExecutionStore({ type: "finished", success: false });
    const state = useExecutionStore.getState();
    expect(state.pendingApproval).toBeNull();
    expect(state.phase).toBe("failed");
    expect(state.phase).not.toBe("awaiting_approval");
  });

  it("never re-arms a decided gate from a late duplicate pending_approval", () => {
    feedSSEEventToExecutionStore({
      type: "pending_approval",
      toolId: "files_write",
      pausedRunId: "gate-hang-2",
    });
    useExecutionStore.getState().resolveApproval("approved");
    expect(useExecutionStore.getState().pendingApproval).toBeNull();
    expect(useExecutionStore.getState().resolvedPausedRunIds).toContain("gate-hang-2");

    // Late duplicate for the same gate — must not re-arm.
    feedSSEEventToExecutionStore({
      type: "pending_approval",
      toolId: "files_write",
      pausedRunId: "gate-hang-2",
    });
    const state = useExecutionStore.getState();
    expect(state.pendingApproval).toBeNull();
    expect(state.phase).not.toBe("awaiting_approval");
  });

  it("endRun('failed') clears a pending gate as a terminal outcome", () => {
    useExecutionStore.getState().startRun();
    feedSSEEventToExecutionStore({
      type: "pending_approval",
      toolId: "files_write",
      pausedRunId: "gate-hang-3",
    });
    expect(useExecutionStore.getState().pendingApproval).not.toBeNull();

    useExecutionStore.getState().endRun("failed");
    const state = useExecutionStore.getState();
    expect(state.pendingApproval).toBeNull();
    expect(state.phase).not.toBe("awaiting_approval");
  });
});
