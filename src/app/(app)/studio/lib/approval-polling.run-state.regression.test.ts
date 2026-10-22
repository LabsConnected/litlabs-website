import { describe, it, expect, vi, afterEach } from "vitest";
import {
  submitApprovalAndPoll,
  watchApprovalResolution,
  type ApprovalRunResult,
  type ApprovalRunStatus,
  type ApprovalWatchOutcome,
} from "./approval-polling";

/**
 * Regression tests — run-state integrity in the approval polling
 * contract (Repair R4, Diagnosis E3-S2 + E1-F3).
 *
 * The defects:
 *  1. The outcome contract could not represent "cancelled":
 *     ApprovalRunStatus.runStatus had no "cancelled", the server folded
 *     run.cancelled → "failed", and the watcher had no settle state for
 *     it — a cancelled run converged (if at all) as a failure, and the
 *     mission panel kept announcing a live gate.
 *  2. The watcher's 15-minute timeout exited SILENTLY — no onSettled
 *     call existed for it, so "unknown" was indistinguishable from
 *     "still running".
 *  3. The submit-poll could not see a nested re-pause: a resumed
 *     segment that paused again at a NEW gate left the card parked in
 *     "executing" until POLL_TIMEOUT_MS, while the server waited on the
 *     user at the new gate.
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

function queueFetch(...responses: Array<ApprovalRunStatus | "gone" | null>) {
  const queue = [...responses];
  return vi.fn(async () => (queue.length > 0 ? queue.shift()! : null));
}

function collectWatch(): { outcomes: ApprovalWatchOutcome[]; onSettled: (o: ApprovalWatchOutcome) => void } {
  const outcomes: ApprovalWatchOutcome[] = [];
  return { outcomes, onSettled: (o) => outcomes.push(o) };
}

async function settledWatch(outcomes: ApprovalWatchOutcome[], tries = 60) {
  for (let i = 0; i < tries && outcomes.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  return outcomes[0];
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function queueHttp(...responses: Response[]) {
  const queue = [...responses];
  return vi.fn(async () =>
    queue.length > 0 ? queue.shift()! : jsonResp({ error: "gone" }, 404),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const CANCELLED_RESULT: ApprovalRunResult = {
  finalText: "",
  stepsUsed: 3,
  toolCalls: [],
  cancelled: true,
  cancelReason: "Cancelled by user",
};

describe("watchApprovalResolution — cancelled outcomes (R4/E3-S2)", () => {
  it("(b1) settles a cancelled run as runStatus 'cancelled' — a distinct outcome, not 'failed', not silence", async () => {
    const fetchStatus = queueFetch(
      statusBody({ status: "approved", runStatus: "processing" }),
      statusBody({ status: "approved", runStatus: "cancelled", runResult: CANCELLED_RESULT }),
    );
    const { outcomes, onSettled } = collectWatch();
    watchApprovalResolution({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      onSettled,
      fetchStatus,
      sleep: noSleep,
    });

    const outcome = await settledWatch(outcomes);
    expect(outcome).toBeDefined();
    expect(outcome?.runStatus).toBe("cancelled");
    expect(outcome?.runResult?.cancelled).toBe(true);
    expect(outcome?.runResult?.cancelReason).toBe("Cancelled by user");
  });

  it("(b2) the watcher timeout produces an outcome instead of exiting silently", async () => {
    // The gate never settles within the watch window (wedged run). The
    // watcher must SAY so — an explicit timed-out/unknown outcome the UI
    // can surface — rather than stopping with no signal at all.
    const fetchStatus = vi.fn(async () => statusBody({ status: "pending" }));
    const { outcomes, onSettled } = collectWatch();
    watchApprovalResolution({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      onSettled,
      fetchStatus,
      sleep: () => new Promise((r) => setTimeout(r, 5)),
      timeoutMs: 40,
    });

    const outcome = await settledWatch(outcomes, 100);
    expect(outcome).toBeDefined();
    expect(outcome?.status).toBe("timeout");
    expect(outcome?.runStatus).toBeNull();
  });

  it("(d2) settles promptly when the run re-pauses at a NEW gate — the outcome hands the UI the new gate", async () => {
    const fetchStatus = queueFetch(
      statusBody({ status: "approved", runStatus: "processing" }),
      statusBody({
        status: "approved",
        runStatus: "processing",
        pendingApproval: {
          toolId: "files.write",
          pausedRunId: "paused-2",
          reason: "Mutation requires approval in ACT mode",
        },
      }),
    );
    const { outcomes, onSettled } = collectWatch();
    watchApprovalResolution({
      conversationId: "conv-1",
      pausedRunId: "run-1",
      onSettled,
      fetchStatus,
      sleep: noSleep,
    });

    const outcome = await settledWatch(outcomes);
    expect(outcome).toBeDefined();
    expect(outcome?.runResult?.pendingApproval?.pausedRunId).toBe("paused-2");
    expect(outcome?.pendingApproval?.pausedRunId).toBe("paused-2");
  });
});

describe("submitApprovalAndPoll — cancelled + re-pause (R4/E3-S2, E1-F3)", () => {
  interface Settle {
    completed: ApprovalRunResult[];
    failed: Array<{ error: string; info?: unknown }>;
    cancelled: Array<{ result: ApprovalRunResult | null; reason?: string }>;
    accepted: number;
  }

  function watch() {
    const settle: Settle = { completed: [], failed: [], cancelled: [], accepted: 0 };
    return {
      settle,
      cbs: {
        onAccepted: () => { settle.accepted += 1; },
        onCompleted: (r: ApprovalRunResult) => settle.completed.push(r),
        onFailed: (e: string, info?: unknown) => settle.failed.push({ error: e, info }),
        onCancelled: (result: ApprovalRunResult | null, reason?: string) =>
          settle.cancelled.push({ result, reason }),
      },
    };
  }

  async function settledClick(settle: Settle) {
    for (
      let i = 0;
      i < 60 && settle.completed.length === 0 && settle.failed.length === 0 && settle.cancelled.length === 0;
      i++
    ) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return settle;
  }

  it("(b3) a cancelled run settles via onCancelled — never as a failure, never as a timeout", async () => {
    const fetchImpl = queueHttp(
      jsonResp({ resolved: true, decision: "approved", status: "processing", runStatus: "processing" }, 202),
      jsonResp({ status: "approved", runStatus: "cancelled", runResult: CANCELLED_RESULT }),
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
    expect(result.cancelled).toHaveLength(1);
    expect(result.cancelled[0].result?.cancelReason).toBe("Cancelled by user");
    expect(result.failed).toHaveLength(0);
    expect(result.completed).toHaveLength(0);
  });

  it("(d) a GET reporting a NEW nested gate hands off promptly — the poll exits 'executing' with the new gate", async () => {
    // The resumed segment pauses again at paused-2 while this gate's
    // derived outcome still reads "processing" (its handoff event is
    // outside the outcome read window); the GET names the live gate at
    // top level. The poll must hand off NOW — before the fix it ignored
    // the field entirely and parked until the 15-minute timeout.
    const fetchImpl = queueHttp(
      jsonResp({ resolved: true, decision: "approved", status: "processing", runStatus: "processing" }, 202),
      jsonResp({ status: "approved", runStatus: "processing" }),
      jsonResp({
        status: "approved",
        runStatus: "processing",
        pendingApproval: {
          toolId: "files.write",
          pausedRunId: "paused-2",
          reason: "Mutation requires approval in ACT mode",
        },
      }),
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
    expect(result.cancelled).toHaveLength(0);
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0].pendingApproval?.pausedRunId).toBe("paused-2");
    expect(result.completed[0].pendingApproval?.pausedRunId).not.toBe("run-1");
    // Prompt: POST + exactly two GETs — no polling into the timeout.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
