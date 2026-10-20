import { describe, it, expect, beforeEach } from "vitest";
import {
  useExecutionStore,
  deriveWorktabBadge,
  type WorktabBadgeSnapshot,
} from "./useExecutionStore";

/**
 * Regression tests — run-state integrity in the execution store
 * (Repair R4, Diagnosis E3-S2/S3).
 *
 * The defects:
 *  - The store had NO cancelled resolution for an approval gate:
 *    resolveApproval knew only approved/rejected, so a run that ended
 *    cancelled could only be converged as a failure (failApproval) or
 *    left mounted — the "Approval needed forever" class.
 *  - deriveWorktabBadge had NO terminal-bad states: a failed or
 *    cancelled run's tab fell back to "idle" (or froze on "working"),
 *    indistinguishable from a tab that never ran.
 */

beforeEach(() => {
  useExecutionStore.getState().reset();
});

function mountGate(pausedRunId = "gate-1") {
  useExecutionStore.getState().setPendingApproval({
    toolId: "files.write",
    reason: "Mutation requires approval in ACT mode",
    pausedRunId,
    conversationId: "conv-1",
  });
}

describe("resolveApproval — cancelled resolution (R4/E3-S2)", () => {
  it("(b4) a cancelled outcome clears the gate, lands the phase on 'cancelled', and records the gate as resolved", () => {
    mountGate();
    useExecutionStore.getState().resolveApproval("cancelled", { pausedRunId: "gate-1" });

    const s = useExecutionStore.getState();
    expect(s.pendingApproval).toBeNull();
    expect(s.phase).toBe("cancelled");
    expect(s.approvalPhase).toBe("idle");
    expect(s.approvalError).toBeNull();
    expect(s.resolvedPausedRunIds).toContain("gate-1");
    // The decision event is recorded as a cancellation, not an approval.
    const resolved = s.events.filter((e) => e.type === "approval_resolved");
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved[resolved.length - 1]?.summary).toBe("Cancelled");
    expect(resolved[resolved.length - 1]?.success).toBe(false);
  });

  it("(b5) a duplicate cancelled outcome for the same gate converges quietly (idempotent)", () => {
    mountGate();
    const exec = useExecutionStore.getState();
    exec.resolveApproval("cancelled", { pausedRunId: "gate-1" });
    const eventsAfterFirst = useExecutionStore.getState().events.length;

    exec.resolveApproval("cancelled", { pausedRunId: "gate-1" });
    const s = useExecutionStore.getState();
    expect(s.phase).toBe("cancelled");
    expect(s.pendingApproval).toBeNull();
    // No duplicate decision event is logged for the replay.
    expect(s.events.filter((e) => e.type === "approval_resolved").length).toBe(
      useExecutionStore.getState().events.filter((e) => e.type === "approval_resolved").length,
    );
    expect(s.events.length).toBe(eventsAfterFirst);
  });

  it("a cancelled outcome tagged for a DIFFERENT gate never touches the live gate (R1b matching preserved)", () => {
    mountGate("gate-2");
    useExecutionStore.getState().resolveApproval("cancelled", { pausedRunId: "gate-1" });

    const s = useExecutionStore.getState();
    expect(s.pendingApproval?.pausedRunId).toBe("gate-2");
    expect(s.phase).toBe("awaiting_approval");
  });
});

describe("deriveWorktabBadge — terminal states (R4/E3-S3)", () => {
  function badge(snapshot: Partial<WorktabBadgeSnapshot>) {
    return deriveWorktabBadge("task-1", {
      "task-1": {
        executionPhase: "idle",
        actionRunDisplayState: null,
        ...snapshot,
      },
    });
  }

  it("a failed projection reads 'failed' — even with an empty local store (the reload case)", () => {
    expect(badge({ executionPhase: "idle", actionRunDisplayState: "failed" })).toBe("failed");
  });

  it("a stopped (cancelled) projection reads 'cancelled'", () => {
    expect(badge({ executionPhase: "idle", actionRunDisplayState: "stopped" })).toBe("cancelled");
  });

  it("terminal local phases read as terminal badges", () => {
    expect(badge({ executionPhase: "failed" })).toBe("failed");
    expect(badge({ executionPhase: "cancelled" })).toBe("cancelled");
  });

  it("a terminal projection outranks a stale local gate phase — a dead run shows no live gate", () => {
    expect(badge({ executionPhase: "awaiting_approval", actionRunDisplayState: "failed" })).toBe("failed");
    expect(badge({ executionPhase: "awaiting_approval", actionRunDisplayState: "stopped" })).toBe("cancelled");
  });

  it("anchors: live and ready derivations are unchanged", () => {
    expect(badge({ executionPhase: "editing" })).toBe("working");
    expect(badge({ executionPhase: "awaiting_approval" })).toBe("needs-approval");
    expect(badge({ executionPhase: "idle", actionRunDisplayState: "waiting_for_user" })).toBe("working");
    expect(badge({ executionPhase: "done", actionRunDisplayState: "completed" })).toBe("ready");
    expect(badge({ executionPhase: "idle", actionRunDisplayState: null })).toBe("idle");
  });
});
