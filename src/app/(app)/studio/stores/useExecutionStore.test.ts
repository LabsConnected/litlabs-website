import { beforeEach, describe, expect, it } from "vitest";
import { feedSSEEventToExecutionStore, useExecutionStore } from "./useExecutionStore";

const GATE = {
  toolId: "files.write",
  reason: "Write index.html",
  pausedRunId: "paused_run_test",
  conversationId: "conv_test",
};

describe("approval failure state convergence (#551)", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("a post-approval run failure clears the actionable gate — no live Approve/Reject, no 'Waiting for approval'", () => {
    const store = useExecutionStore.getState();
    store.setPendingApproval(GATE);
    expect(useExecutionStore.getState().pendingApproval).not.toBeNull();

    // decisionRecorded: true — the run executed and failed; the gate is dead.
    useExecutionStore.getState().failApproval("The resumed run failed on the server.", true, {
      decisionRecorded: true,
    });

    const state = useExecutionStore.getState();
    expect(state.pendingApproval).toBeNull();
    expect(state.phase).toBe("failed");
    expect(state.phase).not.toBe("awaiting_approval");
    expect(state.approvalPhase).toBe("failed");
    expect(state.approvalError).toContain("failed");
  });

  it("an approval POST that never landed keeps the gate actionable — the card must stay, not silently clear", () => {
    const store = useExecutionStore.getState();
    store.setPendingApproval(GATE);

    // decisionRecorded: false — the decision never reached the server;
    // re-sending it is the honest recovery.
    useExecutionStore.getState().failApproval("Approval failed (500)", true, {
      decisionRecorded: false,
    });

    const state = useExecutionStore.getState();
    expect(state.pendingApproval).toMatchObject({ pausedRunId: "paused_run_test" });
    expect(state.phase).toBe("awaiting_approval");
    expect(state.approvalPhase).toBe("failed");
  });

  it("failApproval with no decision signal preserves the old keep-the-card behavior", () => {
    const store = useExecutionStore.getState();
    store.setPendingApproval(GATE);

    useExecutionStore.getState().failApproval("Network error", true);

    const state = useExecutionStore.getState();
    expect(state.pendingApproval).not.toBeNull();
    expect(state.phase).toBe("awaiting_approval");
  });

  it("an expired gate keeps the gate actionable for re-request", () => {
    const store = useExecutionStore.getState();
    store.setPendingApproval(GATE);

    useExecutionStore.getState().failApproval("This approval expired before a decision was made.", true, {
      expired: true,
    });

    const state = useExecutionStore.getState();
    expect(state.pendingApproval).not.toBeNull();
    expect(state.phase).toBe("awaiting_approval");
    expect(state.approvalExpired).toBe(true);
  });

  it("endRun('failed') reports phase 'failed', never 'done'", () => {
    useExecutionStore.getState().endRun("failed");
    expect(useExecutionStore.getState().phase).toBe("failed");
  });
});


describe("execution event projections", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("keeps real workspace diff evidence visible in activity events", () => {
    feedSSEEventToExecutionStore({
      type: "workspace_change",
      status: "changed",
      files: ["src/App.tsx"],
      diff: "-old\n+new",
      additions: 1,
      deletions: 1,
    });

    const event = useExecutionStore.getState().events[0];
    expect(event.summary).toContain("1 file changed");
    expect(event.filePath).toBe("src/App.tsx");
    expect(event.diff).toBe("-old\n+new");
  });

  it("keeps structured verification diagnostics attached to failed checks", () => {
    feedSSEEventToExecutionStore({
      type: "build_result",
      check: "typecheck",
      passed: false,
      errorCount: 1,
      diagnostics: [{
        file: "src/App.tsx",
        line: 12,
        severity: "error",
        message: "Type mismatch",
        source: "typecheck",
      }],
    });

    expect(useExecutionStore.getState().events[0].diagnostics?.[0]).toMatchObject({
      file: "src/App.tsx",
      line: 12,
      message: "Type mismatch",
    });
  });
});
