import { describe, it, expect, vi, afterEach } from "vitest";
import {
  submitApprovalAndPoll,
  watchApprovalResolution,
  type ApprovalRunResult,
  type ApprovalRunStatus,
  type ApprovalWatchOutcome,
} from "./approval-polling";

/**
 * Regression tests for the approval-gate watcher.
 *
 * A paused run's approval can settle without this client clicking anything —
 * decided on another device/session, expired server-side, or resumed while
 * the page was reloading. The watcher must converge those states so the UI
 * is never stuck on a dead approval card (post-build composer hidden).
 */

const noSleep = () => Promise.resolve();

function statusBody(overrides: Partial<ApprovalRunStatus>): ApprovalRunStatus {
  return {
    status: "pending",
    runStatus: null,
    runResult: null,
    runError: null,
    ...overrides,
  };
}

/** Build a fetchStatus stub that replays the queued responses in order. */
function queueFetch(...responses: Array<ApprovalRunStatus | "gone" | null>) {
  const queue = [...responses];
  return vi.fn(async () => queue.length > 0 ? queue.shift()! : null);
}

function collect(): { outcomes: ApprovalWatchOutcome[]; onSettled: (o: ApprovalWatchOutcome) => void } {
  const outcomes: ApprovalWatchOutcome[] = [];
  return { outcomes, onSettled: (o) => outcomes.push(o) };
}

/** Wait until the watcher settles or a small deadline passes. */
async function settled(outcomes: ApprovalWatchOutcome[]) {
  for (let i = 0; i < 50 && outcomes.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  return outcomes[0];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("watchApprovalResolution", () => {
  it("keeps watching through pending/processing and settles on completed", async () => {
    const fetchStatus = queueFetch(
      statusBody({ status: "pending" }),
      statusBody({ status: "approved", runStatus: "processing" }),
      statusBody({
        status: "approved",
        runStatus: "completed",
        runResult: {
          finalText: "Deployed",
          stepsUsed: 2,
          toolCalls: [{ toolId: "project.deploy", success: true, summary: "live", mutating: true }],
          cancelled: false,
        },
      }),
    );
    const { outcomes, onSettled } = collect();
    watchApprovalResolution({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      onSettled,
      fetchStatus,
      sleep: noSleep,
    });

    const outcome = await settled(outcomes);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(outcome?.status).toBe("approved");
    expect(outcome?.runStatus).toBe("completed");
    expect(outcome?.runResult?.toolCalls[0]?.toolId).toBe("project.deploy");
  });

  it("settles immediately when the gate was rejected elsewhere", async () => {
    const fetchStatus = queueFetch(statusBody({ status: "rejected" }));
    const { outcomes, onSettled } = collect();
    watchApprovalResolution({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      onSettled,
      fetchStatus,
      sleep: noSleep,
    });

    const outcome = await settled(outcomes);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(outcome?.status).toBe("rejected");
  });

  it("settles with runError when the resumed run failed", async () => {
    const fetchStatus = queueFetch(
      statusBody({ status: "approved", runStatus: "processing" }),
      statusBody({ status: "approved", runStatus: "failed", runError: "deploy exploded" }),
    );
    const { outcomes, onSettled } = collect();
    watchApprovalResolution({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      onSettled,
      fetchStatus,
      sleep: noSleep,
    });

    const outcome = await settled(outcomes);
    expect(outcome?.status).toBe("approved");
    expect(outcome?.runStatus).toBe("failed");
    expect(outcome?.runError).toBe("deploy exploded");
  });

  it("settles when the pause expired server-side", async () => {
    const fetchStatus = queueFetch(
      statusBody({ status: "pending" }),
      statusBody({ status: "expired" }),
    );
    const { outcomes, onSettled } = collect();
    watchApprovalResolution({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      onSettled,
      fetchStatus,
      sleep: noSleep,
    });

    const outcome = await settled(outcomes);
    expect(outcome?.status).toBe("expired");
  });

  it("settles as gone on a 404 — the local card is stale", async () => {
    const fetchStatus = queueFetch("gone");
    const { outcomes, onSettled } = collect();
    watchApprovalResolution({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      onSettled,
      fetchStatus,
      sleep: noSleep,
    });

    const outcome = await settled(outcomes);
    expect(outcome?.status).toBe("gone");
  });

  it("keeps polling through transient null responses", async () => {
    const fetchStatus = queueFetch(
      null,
      null,
      statusBody({ status: "rejected" }),
    );
    const { outcomes, onSettled } = collect();
    watchApprovalResolution({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      onSettled,
      fetchStatus,
      sleep: noSleep,
    });

    const outcome = await settled(outcomes);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(outcome?.status).toBe("rejected");
  });

  it("stops polling after cancel()", async () => {
    const fetchStatus = queueFetch(statusBody({ status: "pending" }));
    const { outcomes, onSettled } = collect();
    const cancel = watchApprovalResolution({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      onSettled,
      fetchStatus,
      sleep: noSleep,
    });
    cancel();
    await new Promise((r) => setTimeout(r, 20));
    const calls = fetchStatus.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchStatus.mock.calls.length).toBe(calls);
    expect(outcomes.length).toBe(0);
  });
});

/**
 * Regression tests for the click path's detached-resume convergence.
 *
 * The resumed execution runs DETACHED from the approval POST — it can
 * finish before the client's first poll, before the POST even lands
 * (decision recorded on another device), or outlive the page that
 * submitted it. The click path must pull the persisted outcome instead
 * of dead-ending, and must keep missing/expired gate errors honest.
 */
describe("submitApprovalAndPoll — detached resume", () => {
  const RUN_RESULT: ApprovalRunResult = {
    finalText: "Deployed",
    stepsUsed: 2,
    toolCalls: [{ toolId: "project.deploy", success: true, summary: "live", mutating: true }],
    cancelled: false,
  };

  function jsonResp(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  /** fetchImpl that replays POST then GET responses in order. */
  function queueHttp(...responses: Response[]) {
    const queue = [...responses];
    return vi.fn(async () => queue.length > 0 ? queue.shift()! : jsonResp({ error: "gone" }, 404)) as unknown as typeof fetch;
  }

  interface Settle {
    completed: ApprovalRunResult[];
    failed: string[];
    accepted: number;
  }

  function watch(): { settle: Settle; cbs: Pick<Parameters<typeof submitApprovalAndPoll>[0], "onAccepted" | "onCompleted" | "onFailed"> } {
    const settle: Settle = { completed: [], failed: [], accepted: 0 };
    return {
      settle,
      cbs: {
        onAccepted: () => { settle.accepted += 1; },
        onCompleted: (r) => settle.completed.push(r),
        onFailed: (e) => settle.failed.push(e),
      },
    };
  }

  async function settledClick(settle: Settle) {
    for (let i = 0; i < 50 && settle.completed.length === 0 && settle.failed.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return settle;
  }

  it("pulls the outcome when the detached run already completed before the click landed", async () => {
    // The resumed run finished before this client's approval POST was
    // processed (decision recorded on another device/session). The 202
    // reports status "completed" but carries no runResult — the client
    // must GET the persisted outcome instead of dead-ending silently.
    const fetchImpl = queueHttp(
      jsonResp({ resolved: true, decision: "approved", status: "completed", runStatus: "completed" }, 202),
      jsonResp({ status: "approved", runStatus: "completed", runResult: RUN_RESULT }),
    );
    const { settle, cbs } = watch();
    submitApprovalAndPoll({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      decision: "approved",
      ...cbs,
      fetchImpl,
      sleep: noSleep,
    });

    const result = await settledClick(settle);
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0]?.finalText).toBe("Deployed");
    expect(result.failed).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("polls a processing detached run through to completion", async () => {
    const fetchImpl = queueHttp(
      jsonResp({ resolved: true, decision: "approved", status: "processing", runStatus: "processing" }, 202),
      jsonResp({ status: "approved", runStatus: "processing" }),
      jsonResp({ status: "approved", runStatus: "completed", runResult: RUN_RESULT }),
    );
    const { settle, cbs } = watch();
    submitApprovalAndPoll({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      decision: "approved",
      ...cbs,
      fetchImpl,
      sleep: noSleep,
    });

    const result = await settledClick(settle);
    expect(result.accepted).toBe(1);
    expect(result.completed[0]?.toolCalls[0]?.toolId).toBe("project.deploy");
    expect(result.failed).toHaveLength(0);
  });

  it("surfaces the detached run's real failure, never a fake success", async () => {
    const fetchImpl = queueHttp(
      jsonResp({ resolved: true, decision: "approved", status: "processing", runStatus: "processing" }, 202),
      jsonResp({ status: "approved", runStatus: "failed", runError: "deploy exploded" }),
    );
    const { settle, cbs } = watch();
    submitApprovalAndPoll({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      decision: "approved",
      ...cbs,
      fetchImpl,
      sleep: noSleep,
    });

    const result = await settledClick(settle);
    expect(result.completed).toHaveLength(0);
    expect(result.failed).toEqual(["deploy exploded"]);
  });

  it("keeps the honest 404 error for a missing/expired paused run", async () => {
    const fetchImpl = queueHttp(
      jsonResp({ error: "Approval not found or expired" }, 404),
    );
    const { settle, cbs } = watch();
    submitApprovalAndPoll({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      decision: "approved",
      ...cbs,
      fetchImpl,
      sleep: noSleep,
    });

    const result = await settledClick(settle);
    expect(result.completed).toHaveLength(0);
    expect(result.failed).toEqual(["Approval not found or expired"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces an expired gate honestly instead of polling into a timeout", async () => {
    const fetchImpl = queueHttp(
      jsonResp({ error: "Approval could not be resolved (expired or already resolved)" }, 409),
      jsonResp({ status: "expired", runStatus: null }),
    );
    const { settle, cbs } = watch();
    submitApprovalAndPoll({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      decision: "approved",
      ...cbs,
      fetchImpl,
      sleep: noSleep,
    });

    const result = await settledClick(settle);
    expect(result.completed).toHaveLength(0);
    expect(result.failed[0]).toContain("expired");
  });

  it("a rejection settles immediately — nothing resumes server-side", async () => {
    const fetchImpl = queueHttp(
      jsonResp({ resolved: true, decision: "rejected", status: "completed" }),
    );
    const { settle, cbs } = watch();
    submitApprovalAndPoll({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      decision: "rejected",
      ...cbs,
      fetchImpl,
      sleep: noSleep,
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(settle.accepted).toBe(1);
    expect(settle.completed).toHaveLength(0);
    expect(settle.failed).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("delivers a nested re-gate's NEW pausedRunId to onCompleted — the second approval must be actionable", async () => {
    // Multi-gate contract: the resumed run hits ANOTHER approval gate.
    // The server persists a fresh paused run and reports it on the
    // completed runResult; the client must receive the NEW pausedRunId
    // so it can mount a fresh, resumable card — never the dead old gate.
    const nestedResult: ApprovalRunResult = {
      finalText: "I need approval for the deploy step too.",
      stepsUsed: 4,
      toolCalls: [],
      cancelled: false,
      pendingApproval: {
        toolId: "project.deploy",
        pausedRunId: "paused-2",
        reason: "Deploy requires approval",
      },
    };
    const fetchImpl = queueHttp(
      jsonResp({ resolved: true, decision: "approved", status: "processing", runStatus: "processing" }, 202),
      jsonResp({ status: "approved", runStatus: "completed", runResult: nestedResult }),
    );
    const { settle, cbs } = watch();
    submitApprovalAndPoll({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      decision: "approved",
      ...cbs,
      fetchImpl,
      sleep: noSleep,
    });

    const result = await settledClick(settle);
    expect(result.failed).toHaveLength(0);
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0]?.pendingApproval?.pausedRunId).toBe("paused-2");
    expect(result.completed[0]?.pendingApproval?.pausedRunId).not.toBe("run-1");
  });
});

describe("approval lifecycle — card state machine (useExecutionStore)", () => {
  it("a nested gate re-mounts a fresh card after the old gate settles", async () => {
    const { useExecutionStore } = await import("../stores/useExecutionStore");
    const exec = useExecutionStore.getState();

    // Gate 1 mounted.
    exec.setPendingApproval({
      toolId: "files.write",
      reason: "Mutation requires approval",
      pausedRunId: "run-1",
    });
    expect(useExecutionStore.getState().pendingApproval?.pausedRunId).toBe("run-1");

    // Gate 1 approved → resumed run completed but hit a NEW gate.
    // applyApprovalOutcome clears the old card (endRun) then mounts the
    // new one — mirroring the real component path.
    exec.endRun("cancelled");
    exec.setPendingApproval({
      toolId: "project.deploy",
      reason: "Deploy requires approval",
      pausedRunId: "run-2",
    });

    const state = useExecutionStore.getState();
    expect(state.pendingApproval?.pausedRunId).toBe("run-2");
    expect(state.pendingApproval?.toolId).toBe("project.deploy");
    expect(state.phase).toBe("awaiting_approval");
  });

  it("expired/gone gates clear the card without recording a phantom decision", async () => {
    const { useExecutionStore } = await import("../stores/useExecutionStore");
    const exec = useExecutionStore.getState();

    exec.setPendingApproval({
      toolId: "files.write",
      reason: "Mutation requires approval",
      pausedRunId: "run-3",
    });
    const eventsBefore = useExecutionStore.getState().events.filter(
      (e) => e.type === "approval_resolved",
    ).length;

    exec.endRun("cancelled");

    const state = useExecutionStore.getState();
    expect(state.pendingApproval).toBeNull();
    // No approval_resolved event — the user never decided.
    const eventsAfter = state.events.filter((e) => e.type === "approval_resolved").length;
    expect(eventsAfter).toBe(eventsBefore);
  });
});

/**
 * Regression tests for the 2026-09-18 approval-lifecycle re-fix.
 *
 * The defect: handleResolveApproval cleared the approval card BEFORE the
 * POST completed, so a non-2xx approval POST silently cleared the UI —
 * the user saw nothing, the error vanished, and the model re-requested
 * the approval (infinite loop). The fix keeps the card mounted through
 * submitting/executing and lands failures visibly on the card with a
 * Retry affordance (re-POSTs the same pausedRunId — the server re-runs
 * the same record, never a new approval or a new billing operation).
 */
describe("submitApprovalAndPoll — failure visibility and retryability", () => {
  function jsonResp(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function queueHttp(...responses: Response[]) {
    const queue = [...responses];
    return vi.fn(async () => queue.length > 0 ? queue.shift()! : jsonResp({ error: "gone" }, 404)) as unknown as typeof fetch;
  }

  async function runOnce(fetchImpl: typeof fetch, decision: "approved" | "rejected" = "approved") {
    const failed: Array<{ error: string; info?: { retryable: boolean } }> = [];
    const completed: unknown[] = [];
    let accepted = 0;
    submitApprovalAndPoll({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      decision,
      onAccepted: () => { accepted += 1; },
      onCompleted: (r) => completed.push(r),
      onFailed: (error, info) => failed.push({ error, info }),
      fetchImpl,
      sleep: noSleep,
    });
    for (let i = 0; i < 50 && failed.length === 0 && completed.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return { failed, completed, accepted };
  }

  it("a non-2xx POST surfaces the backend error as retryable — the card must stay, not silently clear", async () => {
    const fetchImpl = queueHttp(jsonResp({ error: "Resume worker crashed" }, 500));
    const { failed, completed } = await runOnce(fetchImpl);

    expect(completed).toHaveLength(0);
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toBe("Resume worker crashed");
    expect(failed[0].info?.retryable).toBe(true);
    // No polling after a rejected POST — exactly one request went out.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a 4xx POST is not retryable — retrying the same request cannot succeed", async () => {
    const fetchImpl = queueHttp(jsonResp({ error: "Conversation mismatch" }, 403));
    const { failed } = await runOnce(fetchImpl);

    expect(failed).toHaveLength(1);
    expect(failed[0].error).toBe("Conversation mismatch");
    expect(failed[0].info?.retryable).toBe(false);
  });

  it("an already-failed run on the 202 response is retryable via the same pausedRunId", async () => {
    const fetchImpl = queueHttp(
      jsonResp({ resolved: true, decision: "approved", status: "failed", runStatus: "failed", runError: "image provider timed out" }, 202),
    );
    const { failed } = await runOnce(fetchImpl);

    expect(failed).toHaveLength(1);
    expect(failed[0].error).toBe("image provider timed out");
    expect(failed[0].info?.retryable).toBe(true);
  });

  it("an expired gate is retryable via Request again — expiry no longer dead-ends the run", async () => {
    const fetchImpl = queueHttp(
      jsonResp({ error: "Approval could not be resolved (expired or already resolved)" }, 409),
      jsonResp({ status: "expired", runStatus: null }),
    );
    const { failed } = await runOnce(fetchImpl);

    expect(failed).toHaveLength(1);
    expect(failed[0].error).toContain("expired");
    expect(failed[0].info?.retryable).toBe(true);
    expect(failed[0].info?.expired).toBe(true);
  });
});

describe("approval lifecycle — card phase machine (useExecutionStore)", () => {
  async function freshStore() {
    const { useExecutionStore } = await import("../stores/useExecutionStore");
    const exec = useExecutionStore.getState();
    exec.reset();
    return exec;
  }

  function mountGate(exec: { setPendingApproval: (a: { toolId: string; reason: string; pausedRunId: string }) => void }) {
    exec.setPendingApproval({
      toolId: "image.generate",
      reason: "Generate an image",
      pausedRunId: "run-9",
    });
  }

  it("the card stays mounted through submitting and executing — it only unmounts on a terminal state", async () => {
    const { useExecutionStore } = await import("../stores/useExecutionStore");
    const exec = await freshStore();
    mountGate(exec);

    exec.beginApprovalSubmit();
    let s = useExecutionStore.getState();
    expect(s.pendingApproval?.pausedRunId).toBe("run-9");
    expect(s.approvalPhase).toBe("submitting");

    exec.approvalAccepted();
    s = useExecutionStore.getState();
    expect(s.pendingApproval?.pausedRunId).toBe("run-9");
    expect(s.approvalPhase).toBe("executing");

    // Terminal: approved + completed → the card unmounts.
    exec.resolveApproval("approved");
    s = useExecutionStore.getState();
    expect(s.pendingApproval).toBeNull();
    expect(s.approvalPhase).toBe("idle");
  });

  it("a failed approval keeps the card mounted with the backend error and retry state", async () => {
    const { useExecutionStore } = await import("../stores/useExecutionStore");
    const exec = await freshStore();
    mountGate(exec);

    exec.beginApprovalSubmit();
    exec.failApproval("Resume worker crashed", true);

    const s = useExecutionStore.getState();
    expect(s.pendingApproval?.pausedRunId).toBe("run-9");
    expect(s.approvalPhase).toBe("failed");
    expect(s.approvalError).toBe("Resume worker crashed");
    expect(s.approvalRetryable).toBe(true);
  });

  it("retry re-arms the card to submitting and clears the error — no auto re-request happens by itself", async () => {
    const { useExecutionStore } = await import("../stores/useExecutionStore");
    const exec = await freshStore();
    mountGate(exec);

    exec.failApproval("boom", true);
    exec.beginApprovalSubmit();

    const s = useExecutionStore.getState();
    expect(s.approvalPhase).toBe("submitting");
    expect(s.approvalError).toBeNull();
    expect(s.pendingApproval?.pausedRunId).toBe("run-9");
  });

  it("a fresh gate resets the phase machine", async () => {
    const { useExecutionStore } = await import("../stores/useExecutionStore");
    const exec = await freshStore();
    mountGate(exec);
    exec.failApproval("boom", false);

    exec.setPendingApproval({
      toolId: "project.deploy",
      reason: "Deploy",
      pausedRunId: "run-10",
    });

    const s = useExecutionStore.getState();
    expect(s.pendingApproval?.pausedRunId).toBe("run-10");
    expect(s.approvalPhase).toBe("idle");
    expect(s.approvalError).toBeNull();
    expect(s.approvalRetryable).toBe(true);
  });
});
