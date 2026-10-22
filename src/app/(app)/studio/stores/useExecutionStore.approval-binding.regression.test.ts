import { describe, it, expect, beforeEach } from "vitest";
import { useExecutionStore } from "./useExecutionStore";

/**
 * REPAIR R1b regression — outcome-to-gate matching in the execution store
 * (Diagnosis E1 F4).
 *
 * resolveApproval / failApproval settle WHATEVER gate is current. A late
 * callback belonging to gate N (its submit-poll or the resolution watcher)
 * must never clear or fail gate N+1's live card. The store actions accept
 * the pausedRunId the outcome belongs to and no-op on mismatch.
 */

const GATE_A = "gate-a-paused-run";
const GATE_B = "gate-b-paused-run";

function mountGate(pausedRunId: string) {
  useExecutionStore.getState().setPendingApproval({
    toolId: "files.write",
    reason: "Write requires approval",
    pausedRunId,
    conversationId: "conv-1",
  });
}

describe("useExecutionStore — approval outcome gate binding (R1b / E1 F4)", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("resolveApproval for gate A does NOT clear gate B's pending card", () => {
    mountGate(GATE_B);
    useExecutionStore.getState().resolveApproval("approved", { pausedRunId: GATE_A });
    const s = useExecutionStore.getState();
    expect(s.pendingApproval?.pausedRunId).toBe(GATE_B);
    expect(s.phase).toBe("awaiting_approval");
    expect(s.resolvedPausedRunIds).not.toContain(GATE_A);
  });

  it("failApproval for gate A does NOT fail gate B's pending card", () => {
    mountGate(GATE_B);
    useExecutionStore.getState().failApproval("gate A run failed", true, { pausedRunId: GATE_A });
    const s = useExecutionStore.getState();
    expect(s.pendingApproval?.pausedRunId).toBe(GATE_B);
    expect(s.approvalPhase).not.toBe("failed");
    expect(s.approvalError).toBeNull();
  });

  it("resolveApproval for the CURRENT gate still settles it (matched identity applies)", () => {
    mountGate(GATE_B);
    useExecutionStore.getState().resolveApproval("approved", { pausedRunId: GATE_B });
    const s = useExecutionStore.getState();
    expect(s.pendingApproval).toBeNull();
    expect(s.resolvedPausedRunIds).toContain(GATE_B);
  });

  it("failApproval for the CURRENT gate still fails it (matched identity applies)", () => {
    mountGate(GATE_B);
    useExecutionStore.getState().failApproval("run failed", true, {
      pausedRunId: GATE_B,
      decisionRecorded: true,
    });
    const s = useExecutionStore.getState();
    expect(s.approvalPhase).toBe("failed");
    expect(s.approvalError).toBe("run failed");
    expect(s.pendingApproval).toBeNull();
  });

  it("an outcome for an already-resolved gate does not resurrect or disturb state", () => {
    mountGate(GATE_A);
    useExecutionStore.getState().resolveApproval("approved", { pausedRunId: GATE_A });
    // Gate B mounts afterwards; gate A's late duplicate outcome arrives.
    mountGate(GATE_B);
    useExecutionStore.getState().failApproval("late failure from gate A", true, { pausedRunId: GATE_A });
    const s = useExecutionStore.getState();
    expect(s.pendingApproval?.pausedRunId).toBe(GATE_B);
    expect(s.approvalPhase).not.toBe("failed");
  });
});
