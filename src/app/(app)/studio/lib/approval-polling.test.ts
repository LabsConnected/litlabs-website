import { describe, it, expect, vi, afterEach } from "vitest";
import {
  watchApprovalResolution,
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
