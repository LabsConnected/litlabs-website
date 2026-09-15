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
});
