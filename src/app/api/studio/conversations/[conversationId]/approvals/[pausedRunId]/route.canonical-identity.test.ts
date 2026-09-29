// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests for the canonical execution identity (Item 3).
 *
 * Doctrine: action_runs + ordered action_events is the ONE authority for
 * execution state. The paused run's run_* fields are claim/fencing
 * bookkeeping — never outcome truth. Every consumer reads through
 * getRunOutcomeForPausedRun, and every outcome write goes through the
 * single atomic settle (settleResumedRunOutcome).
 *
 * These tests pin:
 *   1. Executor vs reaper: when the reaper settles the canonical run first,
 *      the executor's later settle hits terminal-immutable and treats it as
 *      the honest outcome — no overwrite, no failure, no second writer.
 *   2. GET derives from the action_run: a stale claim saying "processing"
 *      never masks a completed canonical run.
 *   3. Retry mints a new run: a failed attempt's terminal state is honest
 *      history; the retry executes under a fresh run identity.
 *   4. Terminal-write order: claim verified → canonical write → claim
 *      released, exactly once.
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/litt-intelligence/paused-run-store", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getPausedRun: vi.fn(),
    resolvePausedRun: vi.fn(),
    markRunProcessing: vi.fn(),
    resetRunForRetry: vi.fn(),
    verifyRunClaim: vi.fn(() => Promise.resolve(true)),
    releaseRunClaim: vi.fn(() => Promise.resolve(true)),
    updatePausedRunActionRun: vi.fn(() => Promise.resolve(true)),
    // getRunOutcomeForPausedRun stays REAL — the derivation is under test.
  };
});

vi.mock("@/lib/action-runtime", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getActionRun: vi.fn(),
    listActionEvents: vi.fn(() => Promise.resolve([])),
    transitionActionRunEventActivity: vi.fn(() => Promise.resolve({})),
    createActionRun: vi.fn(),
    appendActionEvent: vi.fn(() => Promise.resolve({})),
    // Preview runtime events fired by the real launch-flow: persistence is
    // out of scope for this wiring test.
    recordActionEventActivity: vi.fn(() => Promise.resolve({})),
  };
});

vi.mock("@/lib/litt-intelligence/workspace-transport", () => ({
  createWorkspaceTransport: vi.fn(() =>
    Promise.resolve({
      workspaceId: "ws-123",
      listFiles: vi.fn(async () => ({ entries: [{ name: "index.html", type: "file" }] })),
      startPreview: vi.fn(async () => ({ status: "ready" })),
      getPreviewStatus: vi.fn(async () => ({ status: "ready" })),
    }),
  ),
}));

vi.mock("@/lib/litt-intelligence/agent-loop-v2", () => ({
  resumeAgentLoopV2: vi.fn(),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(),
}));

vi.mock("@/lib/missions/mission-repository", () => ({
  getCheckpoint: vi.fn(),
}));

vi.mock("@/lib/studio/conversation-service", () => ({
  getAwaitingApprovalAssistantMessage: vi.fn(),
  insertMessage: vi.fn(),
  updateMessageStatus: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/lib/studio/logger", () => ({
  studioLog: vi.fn(),
}));

vi.mock("@/lib/litt-intelligence/quality-loop-flow", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  shouldEnableQualityLoop: vi.fn(() => false),
}));

import { auth } from "@/lib/auth";
import { POST, GET } from "./route";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
  resetRunForRetry,
  verifyRunClaim,
  releaseRunClaim,
  updatePausedRunActionRun,
} from "@/lib/litt-intelligence/paused-run-store";
import { resumeAgentLoopV2 } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import {
  getActionRun,
  listActionEvents,
  transitionActionRunEventActivity,
  createActionRun,
  appendActionEvent,
} from "@/lib/action-runtime";
import {
  getAwaitingApprovalAssistantMessage,
  updateMessageStatus,
} from "@/lib/studio/conversation-service";

const CONV_ID = "conv-123";
const PAUSED_ID = "paused-1";
const USER_ID = "user_123";

function makeRequest(decision: "approved" | "rejected"): NextRequest {
  return new NextRequest(
    `http://localhost/api/studio/conversations/${CONV_ID}/approvals/${PAUSED_ID}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    },
  );
}

const routeParams = { params: Promise.resolve({ conversationId: CONV_ID, pausedRunId: PAUSED_ID }) };

function basePausedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: PAUSED_ID,
    userId: USER_ID,
    conversationId: CONV_ID,
    projectId: "proj-123",
    workspaceId: "ws-123",
    toolId: "files.write",
    toolCallId: "tc-1",
    inputs: { path: "index.html" },
    reason: "Mutation requires approval in ACT mode",
    pausedMessages: [],
    executionMode: "act",
    systemPrompt: "system",
    checkpointId: null,
    actionRunId: "run-1",
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    resolvedAt: null,
    runStatus: null,
    runResult: null,
    runError: null,
    runStartedAt: null,
    runCompletedAt: null,
    ...overrides,
  };
}

function completedLoopResult() {
  return {
    finalText: "Done.",
    stepsUsed: 2,
    toolCalls: [{ toolId: "files.write", success: true, summary: "saved", mutating: true }],
    cancelled: false,
    pendingApproval: undefined,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: USER_ID, clerkId: "clerk_123" } as never);
  vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as never);
  vi.mocked(markRunProcessing).mockResolvedValue(true);
  vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue({
    id: "msg-1",
    role: "assistant",
    content: "Need approval.",
    status: "awaiting_approval",
  } as never);
  vi.mocked(getActionRun).mockResolvedValue({ id: "run-1", status: "waiting_for_user" } as never);
  vi.mocked(listActionEvents).mockResolvedValue([]);
  vi.mocked(transitionActionRunEventActivity).mockResolvedValue({} as never);
  vi.mocked(resumeAgentLoopV2).mockResolvedValue(completedLoopResult());
});

describe("canonical identity — executor vs reaper", () => {
  it("a terminal-immutable settle (reaper won the race) is the honest outcome, not a failure", async () => {
    vi.mocked(getPausedRun).mockResolvedValue(basePausedRun() as never);
    vi.mocked(resolvePausedRun).mockResolvedValue({ ...basePausedRun(), status: "approved" } as never);
    // Claim-path working transition lands; the completion settle finds the
    // run already terminal (reaper settled it first).
    vi.mocked(transitionActionRunEventActivity).mockImplementation(async (args: unknown) => {
      const status = (args as { status?: string }).status;
      if (status === "working") return {} as never;
      throw new Error("ACTION_RUN_TERMINAL_IMMUTABLE");
    });

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    await vi.waitFor(() =>
      expect(updateMessageStatus).toHaveBeenCalledWith(
        "msg-1",
        USER_ID,
        "completed",
        "Done.",
      ),
    );
    // The executor did not fire a second (failed) settle from the catch —
    // exactly two canonical writes were attempted: working + the one
    // terminal attempt that found the truth already recorded.
    expect(vi.mocked(transitionActionRunEventActivity).mock.calls).toHaveLength(2);
    // The claim was not released as a fresh outcome — the reaper owns it.
    expect(releaseRunClaim).not.toHaveBeenCalled();
  });
});

describe("canonical identity — GET derives from the action_run", () => {
  it("a stale 'processing' claim never masks a completed canonical run", async () => {
    // The claim still says processing (executor died between the canonical
    // write and the claim release) — the run ledger says completed.
    vi.mocked(getPausedRun).mockResolvedValue(
      basePausedRun({ status: "approved", runStatus: "processing" }) as never,
    );
    vi.mocked(getActionRun).mockResolvedValue({
      id: "run-1",
      status: "completed",
      startedAt: "2026-09-28T18:00:00.000Z",
      completedAt: "2026-09-28T18:05:00.000Z",
      failureMessage: null,
    } as never);
    vi.mocked(listActionEvents).mockResolvedValue([
      { type: "approval.approved", payload: {} },
      {
        type: "run.completed",
        payload: { result: { finalText: "Done.", stepsUsed: 2, toolCalls: [], cancelled: false } },
      },
    ] as never);

    const res = await GET(
      new NextRequest(`http://localhost/api/studio/conversations/${CONV_ID}/approvals/${PAUSED_ID}`),
      routeParams,
    );
    const body = await res.json();
    expect(body.runStatus).toBe("completed");
    expect(body.runResult.finalText).toBe("Done.");
    expect(body.runError).toBeNull();
    expect(body.runCompletedAt).toBe("2026-09-28T18:05:00.000Z");
  });

  it("a nested-gate handoff derives completed with the nested gate's ID", async () => {
    vi.mocked(getPausedRun).mockResolvedValue(
      basePausedRun({ status: "approved", runStatus: "processing" }) as never,
    );
    vi.mocked(getActionRun).mockResolvedValue({
      id: "run-1",
      status: "waiting_for_user",
      startedAt: "2026-09-28T18:00:00.000Z",
      completedAt: null,
      failureMessage: null,
    } as never);
    vi.mocked(listActionEvents).mockResolvedValue([
      { type: "approval.approved", payload: {} },
      {
        type: "approval.required",
        payload: {
          result: {
            finalText: "Need deploy approval.",
            pendingApproval: { toolId: "project.deploy", pausedRunId: "paused-2" },
          },
        },
      },
    ] as never);

    const res = await GET(
      new NextRequest(`http://localhost/api/studio/conversations/${CONV_ID}/approvals/${PAUSED_ID}`),
      routeParams,
    );
    const body = await res.json();
    expect(body.runStatus).toBe("completed");
    expect(body.runResult.pendingApproval.pausedRunId).toBe("paused-2");
  });

  it("legacy rows without an action_run fall back to the row's claim fields", async () => {
    vi.mocked(getPausedRun).mockResolvedValue(
      basePausedRun({
        actionRunId: null,
        status: "approved",
        runStatus: "failed",
        runError: "boom",
      }) as never,
    );

    const res = await GET(
      new NextRequest(`http://localhost/api/studio/conversations/${CONV_ID}/approvals/${PAUSED_ID}`),
      routeParams,
    );
    const body = await res.json();
    expect(body.runStatus).toBe("failed");
    expect(body.runError).toBe("boom");
    expect(getActionRun).not.toHaveBeenCalled();
  });
});

describe("canonical identity — retry mints a new run", () => {
  it("a failed attempt's terminal state stays history; the retry runs as a fresh run", async () => {
    // Gate state after the first attempt failed and its claim was released.
    vi.mocked(getPausedRun).mockResolvedValue(
      basePausedRun({ status: "approved", runStatus: "failed", actionRunId: "run-old" }) as never,
    );
    // The canonical run holds the terminal truth.
    vi.mocked(getActionRun).mockImplementation(async (runId: unknown) => {
      if (runId === "run-old") {
        return { id: "run-old", status: "failed", failureMessage: "Task failed" } as never;
      }
      return { id: "run-new", status: "working" } as never;
    });
    vi.mocked(listActionEvents).mockImplementation(async (runId: unknown) => {
      if (runId === "run-old") {
        return [{ type: "run.failed", payload: {} }] as never;
      }
      return [] as never;
    });
    vi.mocked(resetRunForRetry).mockResolvedValue(true);
    vi.mocked(createActionRun).mockResolvedValue({ id: "run-new" } as never);
    vi.mocked(updatePausedRunActionRun).mockResolvedValue(true);

    const res = await POST(makeRequest("approved"), routeParams);
    // Not a 409: the failed parent is exactly what a retry is for.
    expect(res.status).toBe(202);

    // One run = one attempt: a fresh canonical run was minted and the gate
    // repointed at it after the claim.
    expect(createActionRun).toHaveBeenCalledTimes(1);
    expect(createActionRun).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, kind: "agent" }),
    );
    expect(updatePausedRunActionRun).toHaveBeenCalledWith(PAUSED_ID, USER_ID, "run-new");

    // The claim-path transition ran against the NEW run, never the failed one.
    await vi.waitFor(() =>
      expect(transitionActionRunEventActivity).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-new", status: "working", eventType: "approval.approved" }),
      ),
    );
    const runIds = vi.mocked(transitionActionRunEventActivity).mock.calls.map(
      (c) => (c[0] as { runId?: string }).runId,
    );
    expect(runIds).not.toContain("run-old");
  });

  it("a cancelled parent stays historical — retry is only for failed attempts", async () => {
    vi.mocked(getPausedRun).mockResolvedValue(
      basePausedRun({ status: "approved", runStatus: "failed", actionRunId: "run-old" }) as never,
    );
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-old", status: "cancelled" } as never);

    const res = await POST(makeRequest("approved"), routeParams);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("ACTION_RUN_TERMINAL");
    expect(createActionRun).not.toHaveBeenCalled();
  });

  it("the retry emits a run.retry_of lineage event pointing at the failed attempt", async () => {
    // INV-010: the causal link (failed attempt -> retry attempt) is a
    // durable event on the new run — no schema change, no new run model.
    vi.mocked(getPausedRun).mockResolvedValue(
      basePausedRun({ status: "approved", runStatus: "failed", actionRunId: "run-old" }) as never,
    );
    vi.mocked(getActionRun).mockImplementation(async (runId: unknown) => {
      if (runId === "run-old") {
        return { id: "run-old", status: "failed", failureMessage: "Task failed" } as never;
      }
      return { id: "run-new", status: "working" } as never;
    });
    vi.mocked(listActionEvents).mockImplementation(async (runId: unknown) => {
      if (runId === "run-old") {
        return [{ type: "run.failed", payload: {} }] as never;
      }
      return [] as never;
    });
    vi.mocked(resetRunForRetry).mockResolvedValue(true);
    vi.mocked(createActionRun).mockResolvedValue({ id: "run-new" } as never);
    vi.mocked(updatePausedRunActionRun).mockResolvedValue(true);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    // Lineage event emitted on the NEW run before the gate was repointed.
    expect(appendActionEvent).toHaveBeenCalledTimes(1);
    expect(appendActionEvent).toHaveBeenCalledWith({
      runId: "run-new",
      userId: USER_ID,
      type: "run.retry_of",
      payload: { causation_action_run_id: "run-old" },
    });
    // Ordering: lineage recorded before the gate points at the new run.
    const eventOrder = vi.mocked(appendActionEvent).mock.invocationCallOrder[0];
    const repointOrder = vi.mocked(updatePausedRunActionRun).mock.invocationCallOrder[0];
    expect(eventOrder).toBeLessThan(repointOrder);
  });

  it("a legacy retry with no prior canonical run emits no lineage event", async () => {
    // A legacy row (no action_run_id) has no causal predecessor in the
    // ledger — the retry still starts, but there is nothing truthful to
    // point the lineage event at, so none is emitted.
    vi.mocked(getPausedRun).mockResolvedValue(
      basePausedRun({
        status: "approved",
        runStatus: "failed",
        actionRunId: null,
        runError: "boom",
      }) as never,
    );
    vi.mocked(listActionEvents).mockResolvedValue([]);
    vi.mocked(resetRunForRetry).mockResolvedValue(true);
    vi.mocked(createActionRun).mockResolvedValue({ id: "run-new" } as never);
    vi.mocked(updatePausedRunActionRun).mockResolvedValue(true);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    expect(createActionRun).toHaveBeenCalledTimes(1);
    expect(updatePausedRunActionRun).toHaveBeenCalledWith(PAUSED_ID, USER_ID, "run-new");
    expect(appendActionEvent).not.toHaveBeenCalled();
  });
});

describe("canonical identity — terminal-write order", () => {
  it("claim verified → canonical write → claim released, exactly once", async () => {
    vi.mocked(getPausedRun).mockResolvedValue(basePausedRun() as never);
    vi.mocked(resolvePausedRun).mockResolvedValue({ ...basePausedRun(), status: "approved" } as never);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    await vi.waitFor(() =>
      expect(releaseRunClaim).toHaveBeenCalledWith(PAUSED_ID, USER_ID, expect.any(String), "completed"),
    );

    const verifyOrder = vi.mocked(verifyRunClaim).mock.invocationCallOrder[0];
    const settleOrders = vi.mocked(transitionActionRunEventActivity).mock.invocationCallOrder;
    const releaseOrder = vi.mocked(releaseRunClaim).mock.invocationCallOrder[0];
    // working (claim) then completed (settle) — exactly two canonical writes.
    expect(settleOrders).toHaveLength(2);
    expect(verifyOrder).toBeLessThan(settleOrders[1]);
    expect(settleOrders[1]).toBeLessThan(releaseOrder);
    const completedArgs = vi.mocked(transitionActionRunEventActivity).mock.calls[1][0] as {
      eventType?: string;
      payload?: { result?: { finalText?: string } };
    };
    expect(completedArgs.eventType).toBe("run.completed");
    expect(completedArgs.payload?.result?.finalText).toBe("Done.");
  });
});
