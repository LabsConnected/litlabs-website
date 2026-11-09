import { describe, it, expect, beforeEach } from "vitest";

import { createApprovalOutcomeGuard } from "./approval-outcome-guard";
import { useExecutionStore } from "../stores/useExecutionStore";

/**
 * Single-flight guard for approval outcomes (§6.3).
 *
 * Production defect (2026-11-08): the approval poller and the approval
 * watcher both observed the same paused-run outcome. When the run
 * resumed into a NESTED gate, the second observer's applyApprovalOutcome
 * call found the new gate mounted as pendingApproval — and
 * resolveApproval("approved") appended a second "Approved" entry for a
 * gate nobody clicked (the phantom "Approved" events at 18:15:31 and
 * 18:15:33 on the 391620db re-test). Only the first observer may
 * process a given pausedRunId outcome; the second is a no-op.
 */

describe("createApprovalOutcomeGuard", () => {
  it("processes the first outcome for a pausedRunId and drops the second", () => {
    const guard = createApprovalOutcomeGuard();
    expect(guard.shouldProcess("gate-A", { resolution: "approved" })).toBe(true);
    expect(guard.shouldProcess("gate-A", { resolution: "approved" })).toBe(false);
  });

  it("tracks each pausedRunId independently", () => {
    const guard = createApprovalOutcomeGuard();
    expect(guard.shouldProcess("gate-A", { resolution: "approved" })).toBe(true);
    expect(guard.shouldProcess("gate-B", { resolution: "approved" })).toBe(true);
    expect(guard.shouldProcess("gate-A", { resolution: "approved" })).toBe(false);
    expect(guard.shouldProcess("gate-B", { resolution: "rejected" })).toBe(false);
  });

  it("never blocks failure outcomes — a failed POST stays retryable under the same pausedRunId", () => {
    const guard = createApprovalOutcomeGuard();
    // First attempt fails (POST never landed / run failed server-side).
    expect(
      guard.shouldProcess("gate-A", { resolution: "approved", runError: "network error" }),
    ).toBe(true);
    // The retry re-issues the same pausedRunId and succeeds — it must
    // still apply, or the card would strand in its failed state.
    expect(guard.shouldProcess("gate-A", { resolution: "approved" })).toBe(true);
    // …and the successful outcome is then single-flight.
    expect(guard.shouldProcess("gate-A", { resolution: "approved" })).toBe(false);
  });

  it("does not track expired/gone outcomes (they never resolve a gate)", () => {
    const guard = createApprovalOutcomeGuard();
    expect(guard.shouldProcess("gate-A", { resolution: "expired" })).toBe(true);
    expect(guard.shouldProcess("gate-A", { resolution: "expired" })).toBe(true);
    expect(guard.shouldProcess("gate-A", { resolution: "gone" })).toBe(true);
  });

  it("passes through outcomes without a pausedRunId", () => {
    const guard = createApprovalOutcomeGuard();
    expect(guard.shouldProcess(undefined, { resolution: "approved" })).toBe(true);
    expect(guard.shouldProcess(undefined, { resolution: "approved" })).toBe(true);
  });
});

describe("approval outcome single-flight — store interaction", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  function approvedEntries() {
    return useExecutionStore
      .getState()
      .events.filter((e) => e.type === "approval_resolved" && e.summary === "Approved");
  }

  it("(d) two observers applying one outcome with a nested gate → exactly one 'Approved' entry, gate mounted once", () => {
    const guard = createApprovalOutcomeGuard();
    const gateA = { toolId: "image_generate", reason: "Approval required", pausedRunId: "gate-A" };
    const gateB = { toolId: "image_generate", reason: "Approval required", pausedRunId: "gate-B" };

    // Gate A is mounted. The poller observes its outcome first.
    useExecutionStore.getState().setPendingApproval(gateA);
    expect(guard.shouldProcess("gate-A", { resolution: "approved" })).toBe(true);
    useExecutionStore.getState().resolveApproval("approved");
    // The resumed run paused again — the nested gate B mounts.
    useExecutionStore.getState().setPendingApproval(gateB);

    // The watcher observes gate A's outcome a moment later. The guard
    // drops it: no second "Approved" entry, gate B stays mounted once.
    expect(guard.shouldProcess("gate-A", { resolution: "approved" })).toBe(false);
    expect(approvedEntries()).toHaveLength(1);
    expect(useExecutionStore.getState().pendingApproval?.pausedRunId).toBe("gate-B");
  });

  it("documents the bug the guard fixes: without it, the second observer duplicates the 'Approved' entry", () => {
    const gateA = { toolId: "image_generate", reason: "Approval required", pausedRunId: "gate-A" };
    const gateB = { toolId: "image_generate", reason: "Approval required", pausedRunId: "gate-B" };

    useExecutionStore.getState().setPendingApproval(gateA);
    useExecutionStore.getState().resolveApproval("approved");
    useExecutionStore.getState().setPendingApproval(gateB);
    // A second applyApprovalOutcome for gate A — what the watcher did
    // before the guard — resolves the NEW gate and appends a phantom entry.
    useExecutionStore.getState().resolveApproval("approved");

    expect(approvedEntries()).toHaveLength(2);
    expect(useExecutionStore.getState().pendingApproval).toBeNull();
  });
});
