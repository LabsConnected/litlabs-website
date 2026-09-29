// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests for approval resume → transcript writeback (P0).
 *
 * The production defect: clicking Continue on an approval gate dismissed
 * the card but the resumed run's result never reached the conversation —
 * the transcript stayed "awaiting_approval" forever and the client
 * fabricated a new run via regenerate() instead of showing the real
 * outcome.
 *
 * These tests verify:
 *   - A completed resume writes its finalText onto the paused assistant
 *     message (status → completed) BEFORE the canonical settle, so a polling
 *     client that sees runStatus=completed can loadMessages and get truth
 *   - A failed resume marks the message failed, never completed
 *   - A rejection closes out the awaiting message with a declined note
 *   - A resumed run that pauses AGAIN persists a new resumable paused run
 *     (pausedRunId on the result) instead of a dead-end approval
 */

// ── Mocks ──

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/litt-intelligence/paused-run-store", () => ({
  getPausedRun: vi.fn(),
  resolvePausedRun: vi.fn(),
  markRunProcessing: vi.fn(),
  verifyRunClaim: vi.fn(() => Promise.resolve(true)),
  releaseRunClaim: vi.fn(() => Promise.resolve(true)),
  updatePausedRunActionRun: vi.fn(() => Promise.resolve(true)),
  getRunOutcomeForPausedRun: vi.fn(),
  createPausedRun: vi.fn(),
  renewRunLease: vi.fn(() => Promise.resolve(true)),
  RUN_HEARTBEAT_MS: 30_000,
  resetRunForRetry: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("@/lib/litt-intelligence/workspace-transport", () => ({
  createWorkspaceTransport: vi.fn(() =>
    Promise.resolve({
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

vi.mock("@/lib/action-runtime", () => ({
  getActionRun: vi.fn(),
  recordActionEventActivity: vi.fn(() => Promise.resolve({})),
  transitionActionRun: vi.fn(() => Promise.resolve({})),
  transitionActionRunEventActivity: vi.fn(() => Promise.resolve({})),
}));

import { auth } from "@/lib/auth";
import { POST } from "./route";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
  verifyRunClaim,
  releaseRunClaim,
  getRunOutcomeForPausedRun,
  createPausedRun,
} from "@/lib/litt-intelligence/paused-run-store";
import { resumeAgentLoopV2 } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { getCheckpoint } from "@/lib/missions/mission-repository";
import {
  getActionRun,
  transitionActionRunEventActivity,
} from "@/lib/action-runtime";
import {
  getAwaitingApprovalAssistantMessage,
  insertMessage,
  updateMessageStatus,
} from "@/lib/studio/conversation-service";

// ── Helpers ──

const CONV_ID = "conv-123";
const PAUSED_ID = "paused-1";

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

/**
 * Find the canonical-settle call (transitionActionRunEventActivity) for a
 * given action-run status. The outcome now lives on the action_run — there
 * is exactly one writer, and these tests assert on it.
 */
function settleCall(status: string) {
  const mocked = vi.mocked(transitionActionRunEventActivity);
  const idx = mocked.mock.calls.findIndex(
    (c) => (c[0] as { status?: string }).status === status,
  );
  if (idx < 0) return null;
  return {
    args: mocked.mock.calls[idx][0] as Record<string, any>,
    order: mocked.mock.invocationCallOrder[idx],
  };
}

const pendingRun = {
  id: PAUSED_ID,
  userId: "user_123",
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
  actionRunId: "run-parent-1",
  status: "pending",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  resolvedAt: null,
  runStatus: null,
  runResult: null,
  runError: null,
  runStartedAt: null,
  runCompletedAt: null,
};

const awaitingMessage = {
  id: "msg-assistant-1",
  role: "assistant",
  content: "I need approval to write files.",
  status: "awaiting_approval",
};

// ── Tests ──

describe("POST /approvals/[pausedRunId] — transcript writeback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
    vi.mocked(getPausedRun).mockResolvedValue(pendingRun as any);
    vi.mocked(resolvePausedRun).mockResolvedValue({ ...pendingRun, status: "approved" } as any);
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "waiting_for_user" } as any);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as any);
    vi.mocked(markRunProcessing).mockResolvedValue(true);
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue(awaitingMessage as any);
  });

  it("cannot resurrect a pending approval after explicit parent-run cancellation", async () => {
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "cancelled" } as any);

    const res = await POST(makeRequest("approved"), routeParams);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("ACTION_RUN_TERMINAL");
    expect(resolvePausedRun).not.toHaveBeenCalled();
    expect(markRunProcessing).not.toHaveBeenCalled();
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
  });

  it("writes the resumed run's finalText onto the awaiting message before completing", async () => {
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "Created index.html with the new hero.",
      stepsUsed: 3,
      toolCalls: [{ toolId: "files.write", success: true, summary: "saved", mutating: true }],
      cancelled: false,
      pendingApproval: undefined,
    } as any);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    await vi.waitFor(() => expect(settleCall("completed")).not.toBeNull());

    // Approval resumed under the same durable parent run: waiting→working
    // at decision time, the exact ActionExecutionContext in loop config,
    // then the same run settled completed after the result writeback —
    // outcome event carries the RunResult on its payload.
    expect(transitionActionRunEventActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-parent-1",
        userId: "user_123",
        status: "working",
        eventType: "approval.approved",
      }),
    );
    const resumeInput = vi.mocked(resumeAgentLoopV2).mock.calls[0][0];
    expect(resumeInput.config?.actionContext).toEqual({
      actionRunId: "run-parent-1",
      userId: "user_123",
      conversationId: CONV_ID,
      projectId: "proj-123",
    });
    const completed = settleCall("completed");
    expect(completed).not.toBeNull();
    expect(completed!.args).toMatchObject({
      runId: "run-parent-1",
      userId: "user_123",
      status: "completed",
      eventType: "run.completed",
      payload: {
        pausedRunId: PAUSED_ID,
        toolId: "files.write",
        result: expect.objectContaining({
          finalText: "Created index.html with the new hero.",
        }),
      },
      patch: expect.objectContaining({ currentActivity: "Task completed" }),
    });
    // The claim was verified before the write and released after it.
    expect(verifyRunClaim).toHaveBeenCalledWith(PAUSED_ID, "user_123", expect.any(String));
    expect(releaseRunClaim).toHaveBeenCalledWith(PAUSED_ID, "user_123", expect.any(String), "completed");

    // The paused message becomes the completed reply — the real outcome,
    // not a fabricated regeneration.
    expect(updateMessageStatus).toHaveBeenCalledWith(
      "msg-assistant-1",
      "user_123",
      "completed",
      "Created index.html with the new hero.",
    );
    // Transcript writeback ran BEFORE the canonical settle.
    const writeOrder = vi.mocked(updateMessageStatus).mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(completed!.order);
    // No separate assistant message was inserted — the awaiting one was reused.
    expect(insertMessage).not.toHaveBeenCalled();
  });

  it("marks the awaiting message failed when the resumed run throws", async () => {
    vi.mocked(resumeAgentLoopV2).mockRejectedValue(new Error("provider exploded"));

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    await vi.waitFor(() => expect(settleCall("failed")).not.toBeNull());
    const failed = settleCall("failed");
    expect(failed!.args).toMatchObject({
      status: "failed",
      eventType: "run.failed",
      patch: expect.objectContaining({
        failureCode: "TASK_FAILED",
        failureMessage: "provider exploded",
      }),
    });
    expect(releaseRunClaim).toHaveBeenCalledWith(PAUSED_ID, "user_123", expect.any(String), "failed");
    expect(updateMessageStatus).toHaveBeenCalledWith(
      "msg-assistant-1",
      "user_123",
      "failed",
      "The resumed run failed: provider exploded",
    );
  });

  it("reports the real model failure when the resumed loop dies after an approved mutation", async () => {
    // Production defect (2026-09-19 golden run): the resumed loop executed
    // the approved image.generate, then every provider route failed. The
    // artifact gate masked that behind "No runnable website entry file was
    // created" — a misleading error that hid the provider exhaustion.
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "LiTT couldn't complete this request because all currently available AI routes were unavailable or reached their limits.",
      stepsUsed: 3,
      toolCalls: [{ toolId: "image.generate", success: true, summary: "generated", mutating: true }],
      cancelled: false,
      modelFailed: "All tool-calling models failed. Attempts: gemini/gemini-3.6-flash(http_429)",
      modelFailureText:
        "LiTT couldn't complete this request because all currently available AI routes were unavailable or reached their limits.",
    } as any);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    await vi.waitFor(() => expect(settleCall("failed")).not.toBeNull());
    const failed = settleCall("failed");
    expect(failed!.args.patch).toMatchObject({
      failureCode: "TASK_FAILED",
      failureMessage:
        "LiTT couldn't complete this request because all currently available AI routes were unavailable or reached their limits.",
    });
    expect(updateMessageStatus).toHaveBeenCalledWith(
      "msg-assistant-1",
      "user_123",
      "failed",
      expect.stringContaining("all currently available AI routes"),
    );
    // An honest loop failure is recorded as failed, never completed.
    expect(settleCall("completed")).toBeNull();
  });

  it("a rejection closes the awaiting message with a truthful declined note and never resumes", async () => {
    const res = await POST(makeRequest("rejected"), routeParams);
    expect(res.status).toBe(200);

    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
    expect(updateMessageStatus).toHaveBeenCalledWith(
      "msg-assistant-1",
      "user_123",
      "completed",
      expect.stringContaining("Declined"),
    );
    expect(transitionActionRunEventActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-parent-1",
        userId: "user_123",
        status: "cancelled",
        eventType: "approval.rejected",
      }),
    );
  });

  it("persists a resumable paused run when the resumed run pauses again", async () => {
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "I need approval for the deploy step too.",
      stepsUsed: 4,
      toolCalls: [],
      cancelled: false,
      pendingApproval: {
        toolId: "deploy.production",
        toolCallId: "tc-9",
        inputs: { environment: "production" },
        reason: "Deploy requires approval",
        pausedMessages: [{ role: "user", content: "x" }],
      },
    } as any);
    vi.mocked(createPausedRun).mockResolvedValue({ id: "paused-2" } as any);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    await vi.waitFor(() => expect(settleCall("waiting_for_user")).not.toBeNull());

    // The nested gate is a REAL paused run — resumable, not a dead end.
    expect(createPausedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONV_ID,
        toolId: "deploy.production",
        toolCallId: "tc-9",
        actionRunId: "run-parent-1",
      }),
    );
    // The outer attempt's outcome and the waiting_for_user transition land
    // in ONE atomic RPC; the RunResult carries the nested gate's ID.
    const handoff = settleCall("waiting_for_user");
    expect(handoff!.args).toMatchObject({
      runId: "run-parent-1",
      status: "waiting_for_user",
      eventType: "approval.required",
      payload: {
        pausedRunId: PAUSED_ID,
        result: expect.objectContaining({
          pendingApproval: expect.objectContaining({ pausedRunId: "paused-2" }),
        }),
      },
      patch: expect.objectContaining({ approvalReference: "paused-2" }),
    });
    // No terminal outcome was recorded for the outer attempt — the run is
    // waiting, not completed.
    expect(settleCall("completed")).toBeNull();
    expect(settleCall("failed")).toBeNull();
    // The transcript message stays awaiting_approval for the new gate.
    expect(updateMessageStatus).toHaveBeenCalledWith(
      "msg-assistant-1",
      "user_123",
      "awaiting_approval",
      "I need approval for the deploy step too.",
    );
  });

  it("inserts a new assistant message when no awaiting message exists", async () => {
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue(null);
    vi.mocked(insertMessage).mockResolvedValue({
      message: { id: "msg-new" },
      duplicate: false,
    } as any);
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "Finished the resumed work.",
      stepsUsed: 2,
      toolCalls: [],
      cancelled: false,
    } as any);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    await vi.waitFor(() => expect(settleCall("completed")).not.toBeNull());
    expect(insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONV_ID,
        role: "assistant",
        content: "Finished the resumed work.",
        status: "completed",
        clientRequestId: `resume:${PAUSED_ID}`,
      }),
    );
  });
});

describe("POST /approvals/[pausedRunId] — checkpoint SHA threading (#551b1)", () => {
  // #551 acceptance re-run #3: createPausedRun persisted only the
  // checkpointId, and the resume fabricated existingCheckpoint with an
  // empty gitSha — so computeWorkspaceChange always reported "unknown"
  // and the artifact gate's workspace-change scoping could never engage.
  // The route now recovers the real pre-mutation SHA from the checkpoint
  // row and threads it into the resume input.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "waiting_for_user" } as any);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as any);
    vi.mocked(markRunProcessing).mockResolvedValue(true);
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue(awaitingMessage as any);
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "done",
      stepsUsed: 1,
      toolCalls: [],
      cancelled: false,
      pendingApproval: undefined,
    } as any);
  });

  it("threads the checkpoint row's real gitSha into existingCheckpoint", async () => {
    vi.mocked(getPausedRun).mockResolvedValue({ ...pendingRun, checkpointId: "chk-1" } as any);
    vi.mocked(resolvePausedRun).mockResolvedValue({
      ...pendingRun,
      checkpointId: "chk-1",
      status: "approved",
    } as any);
    vi.mocked(getCheckpoint).mockResolvedValue({
      id: "chk-1",
      projectId: "proj-123",
      userId: "user_123",
      gitSha: "abc123def456",
      label: "pre-approval",
      description: null,
      missionRunId: null,
      createdAt: new Date().toISOString(),
    } as any);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    expect(getCheckpoint).toHaveBeenCalledWith("chk-1", "user_123");
    const resumeInput = vi.mocked(resumeAgentLoopV2).mock.calls[0][0];
    expect(resumeInput.existingCheckpoint).toEqual({
      checkpointId: "chk-1",
      label: "pre-approval",
      gitSha: "abc123def456",
    });
  });

  it("keeps the empty-SHA behavior when the checkpoint row is missing (legacy rows)", async () => {
    vi.mocked(getPausedRun).mockResolvedValue({ ...pendingRun, checkpointId: "chk-gone" } as any);
    vi.mocked(resolvePausedRun).mockResolvedValue({
      ...pendingRun,
      checkpointId: "chk-gone",
      status: "approved",
    } as any);
    vi.mocked(getCheckpoint).mockResolvedValue(null);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    const resumeInput = vi.mocked(resumeAgentLoopV2).mock.calls[0][0];
    expect(resumeInput.existingCheckpoint).toEqual({
      checkpointId: "chk-gone",
      label: "pre-approval",
      gitSha: "",
    });
  });

  it("leaves existingCheckpoint undefined when the pause recorded no checkpoint", async () => {
    vi.mocked(getPausedRun).mockResolvedValue({ ...pendingRun, checkpointId: null } as any);
    vi.mocked(resolvePausedRun).mockResolvedValue({ ...pendingRun, status: "approved" } as any);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    expect(getCheckpoint).not.toHaveBeenCalled();
    const resumeInput = vi.mocked(resumeAgentLoopV2).mock.calls[0][0];
    expect(resumeInput.existingCheckpoint).toBeUndefined();
  });
});
