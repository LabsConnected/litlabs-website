// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests for Defect D1 — a claimed approval resume can stall
 * silently forever (staging run 00808832 on dc7b9d91, ART-20261020-027).
 *
 * The production defect: after the user approved a gated tool call, the
 * detached resume executor never produced another provider attempt, never
 * wrote an outcome, and never reached a terminal state — no error, no
 * watchdog line, no log at all, while the process stayed healthy and the
 * heartbeat kept the claim lease fresh. The only recovery was a
 * read-triggered reaper that writes no transcript outcome and no log.
 *
 * The executor's promise chain contains unbounded awaits (workspace /
 * database calls guarded against rejection but not against
 * non-settlement). If any of them never settles, the promise never
 * settles and nothing terminates the run. These tests pin the repair:
 * the route's own heartbeat — the one clock that already watches a
 * claimed run — enforces the store's stall definition
 * (RUN_STALL_MS without progress) and settles the run FAILED with the
 * recorded reason "Execution stalled (no progress)" /
 * EXECUTION_STALLED, with the transcript writeback and the billing
 * release the normal settlement path performs.
 */

// ── Mocks (mirrors route.test.ts; the store mock additionally exposes
// RUN_STALL_MS, the stall bound the heartbeat enforces) ──

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/agent-billing", () => ({
  reserveCredits: vi.fn(() =>
    Promise.resolve({ ok: true, runId: "resume-run-1", reservedCredits: 12, reservationId: "resume-res-1" })),
  settleRun: vi.fn(() => Promise.resolve({ ok: true, creditsCharged: 0, creditsRefunded: 0 })),
  estimateCredits: vi.fn(() => 12),
  computeResumeQuoteBits: vi.fn(() => 12),
  resumeQuoteDisclosure: vi.fn(() => " Estimated resume cost: 12 LiTTBits (debited on success; failed work debits zero)."),
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
  RUN_STALL_MS: 12 * 60 * 1000,
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
  isFileWritingTool: (id: string) => ["files.write", "apply_patch", "edit", "code.writeFile", "code.refactor", "files.patch"].includes(id),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(),
  getProject: vi.fn(() => Promise.resolve(null)),
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
vi.mock("@/lib/studio/task-service", () => ({
  attachActionRunToConversationTask: vi.fn(() => Promise.resolve()),
  settleConversationTask: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/action-runtime", () => ({
  getActionRun: vi.fn(),
  recordActionEventActivity: vi.fn(() => Promise.resolve({})),
  transitionActionRun: vi.fn(() => Promise.resolve({})),
  transitionActionRunEventActivity: vi.fn(() => Promise.resolve({})),
}));

import { auth } from "@/lib/auth";
import { settleRun } from "@/lib/agent-billing";
import { POST } from "./route";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
  releaseRunClaim,
} from "@/lib/litt-intelligence/paused-run-store";
import { resumeAgentLoopV2 } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import {
  getActionRun,
  transitionActionRunEventActivity,
} from "@/lib/action-runtime";
import {
  getAwaitingApprovalAssistantMessage,
  updateMessageStatus,
} from "@/lib/studio/conversation-service";
import { studioLog } from "@/lib/studio/logger";

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
  toolId: "image.setPrompt",
  toolCallId: "tc-1",
  inputs: { prompt: "a coffee shop hero image" },
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
  content: "I need approval to set the image prompt.",
  status: "awaiting_approval",
};

const STALL_MS = 12 * 60 * 1000;

// ── Tests ──

describe("POST /approvals/[pausedRunId] — resume stall watchdog (D1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
    vi.mocked(getPausedRun).mockResolvedValue(pendingRun as any);
    vi.mocked(resolvePausedRun).mockResolvedValue({ ...pendingRun, status: "approved" } as any);
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "waiting_for_user" } as any);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as any);
    vi.mocked(markRunProcessing).mockResolvedValue(true);
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue(awaitingMessage as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("settles a claimed resume FAILED when the executor never settles and progress stays frozen past RUN_STALL_MS", async () => {
    // The wedged executor: its promise never settles (an unbounded await
    // in the resume chain never resolves — the staging failure shape).
    vi.mocked(resumeAgentLoopV2).mockImplementation(() => new Promise(() => {}) as never);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);
    expect(resumeAgentLoopV2).toHaveBeenCalled();

    // Just inside the stall bound: still legitimately "working" — the
    // watchdog must NOT have fired.
    await vi.advanceTimersByTimeAsync(STALL_MS - 60_000);
    expect(settleCall("failed")).toBeNull();

    // Past the bound with zero progress: the run must reach a truthful
    // terminal FAILED state with a recorded reason — not hang silently.
    await vi.advanceTimersByTimeAsync(120_000);

    const failed = settleCall("failed");
    expect(failed).not.toBeNull();
    expect(failed!.args).toMatchObject({
      runId: "run-parent-1",
      status: "failed",
      eventType: "run.failed",
      patch: expect.objectContaining({
        failureCode: "EXECUTION_STALLED",
        failureMessage: "Execution stalled (no progress)",
      }),
    });
    // The death is on the record: a log line names the watchdog firing.
    expect(studioLog).toHaveBeenCalledWith(
      "approval:resume_stall_watchdog_fired",
      expect.objectContaining({ pausedRunId: PAUSED_ID }),
    );
    // The transcript resolves too — the awaiting message is marked
    // failed, never left "awaiting_approval" forever.
    expect(updateMessageStatus).toHaveBeenCalledWith(
      "msg-assistant-1",
      "user_123",
      "failed",
      expect.stringContaining("Execution stalled (no progress)"),
    );
    // The claim is released as failed and the billing hold is released
    // exactly once, as a zero-debit failure.
    expect(releaseRunClaim).toHaveBeenCalledWith(PAUSED_ID, "user_123", expect.any(String), "failed");
    expect(settleRun).toHaveBeenCalledTimes(1);
    expect(settleRun).toHaveBeenCalledWith(
      "resume-run-1",
      expect.objectContaining({ status: "failed", actualCredits: 0, error: "EXECUTION_STALLED" }),
      12,
      "resume-res-1",
    );
  });

  it("keys the stall bound on progress, not run age: progress events reset the clock", async () => {
    let capturedProgress: { emit: (event: unknown) => void } | null = null;
    vi.mocked(resumeAgentLoopV2).mockImplementation(((
      _input: unknown,
      _transport: unknown,
      progress: { emit: (event: unknown) => void },
    ) => {
      capturedProgress = progress;
      return new Promise(() => {});
    }) as never);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);
    expect(capturedProgress).not.toBeNull();

    // 11 minutes without progress: inside the bound, no settle.
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(settleCall("failed")).toBeNull();

    // A loop progress event lands: the stall clock restarts from here.
    capturedProgress!.emit({ type: "status", summary: "still working" });

    // Another 11 minutes (22 total, 11 since progress): still no settle.
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(settleCall("failed")).toBeNull();

    // 13 minutes since the last progress event: the watchdog fires.
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(settleCall("failed")).not.toBeNull();
  });

  it("does not fire after a normal completion: the executor's own settle is the only one", async () => {
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "Done.",
      stepsUsed: 2,
      toolCalls: [],
      cancelled: false,
      pendingApproval: undefined,
    } as never);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    // Let the detached chain run to its own settlement.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settleCall("completed")).not.toBeNull();

    // Far past the stall bound: no watchdog settle, no second billing
    // settle — a finished run stays finished.
    await vi.advanceTimersByTimeAsync(STALL_MS + 120_000);
    expect(settleCall("failed")).toBeNull();
    expect(settleRun).toHaveBeenCalledTimes(1);
    expect(settleRun).toHaveBeenCalledWith(
      "resume-run-1",
      expect.objectContaining({ status: "completed" }),
      12,
      "resume-res-1",
    );
  });
});
