// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests for the resume-stall watchdog (2026-11-10).
 *
 * The production defect (staging acceptance run 42761179141, iteration 3):
 * an approved paused run was claimed ("processing"), the detached executor
 * produced ZERO progress events, and nothing in the process ever settled
 * it — the only stall protection was a read-path recovery that fires 12
 * minutes later and only when someone happens to read the gate. The run
 * sat as a silent zombie while every downstream check cascaded.
 *
 * These tests verify the executor-side watchdog in the approvals route:
 *   - A resumed run whose progress goes stale past RUN_STALL_MS is
 *     settled FAILED (EXECUTION_STALLED) by the heartbeat itself, with
 *     the transcript written back as failed — no read required.
 *   - Once the watchdog fires, the executor is fenced: a loop that
 *     returns late writes nothing (no outcome, no transcript overwrite).
 *   - A resumed run that keeps emitting progress is never watchdogged,
 *     even past the stall bound, and settles normally.
 */

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
  RUN_HEARTBEAT_MS: 1_000,
  RUN_STALL_MS: 5_000,
  resetRunForRetry: vi.fn(() => Promise.resolve(false)),
}));

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
  isFileWritingTool: (id: string) => ["files.write", "apply_patch", "edit"].includes(id),
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
import { POST } from "./route";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
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

const CONV_ID = "conv-123";
const PAUSED_ID = "paused-1";

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/studio/conversations/${CONV_ID}/approvals/${PAUSED_ID}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    },
  );
}

const routeParams = { params: Promise.resolve({ conversationId: CONV_ID, pausedRunId: PAUSED_ID }) };

const pendingRun = {
  id: PAUSED_ID,
  userId: "user_123",
  conversationId: CONV_ID,
  projectId: "proj-123",
  workspaceId: "ws-123",
  toolId: "image.stock",
  toolCallId: "tc-1",
  inputs: { query: "coffee beans closeup" },
  reason: "Mutation requires approval in ACT mode",
  pausedMessages: [{ role: "user", content: "Build a landing site" }],
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
  deferredToolCalls: undefined,
  priorToolCalls: undefined,
  stepsUsed: 1,
  hadInterveningMutation: false,
  qualityLoopState: undefined,
};

function settleCalls(status: string) {
  return vi.mocked(transitionActionRunEventActivity).mock.calls
    .map((c) => c[0] as Record<string, any>)
    .filter((a) => a.status === status);
}

async function flushMicrotasks(rounds = 60) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

describe("resume stall watchdog", () => {
  let resolveLoop: (value: unknown) => void;
  let capturedProgress: { emit: (e: unknown) => void } | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    capturedProgress = null;
    vi.mocked(auth).mockResolvedValue({ userId: "user_123" } as never);
    vi.mocked(getPausedRun).mockResolvedValue(pendingRun as never);
    vi.mocked(resolvePausedRun).mockResolvedValue({ ...pendingRun, status: "approved" } as never);
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "working" } as never);
    vi.mocked(markRunProcessing).mockResolvedValue(true as never);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as never);
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue({ id: "msg-1", content: "Approval required." } as never);
    vi.mocked(transitionActionRunEventActivity).mockResolvedValue({} as never);
    vi.mocked(resumeAgentLoopV2).mockImplementation((_resume: unknown, _transport: unknown, progress?: unknown) => {
      capturedProgress = progress as { emit: (e: unknown) => void };
      return new Promise<any>((resolve) => { resolveLoop = resolve; });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("settles a no-progress resumed run as EXECUTION_STALLED without any read", async () => {
    const res = await POST(makeRequest(), routeParams);
    expect(res.status).toBe(202);
    await flushMicrotasks();
    expect(settleCalls("failed")).toHaveLength(0);

    // Heartbeats tick (RUN_HEARTBEAT_MS=1000 in the mock) but the loop
    // emits nothing. Past RUN_STALL_MS (5000 in the mock) the watchdog
    // must settle the run itself.
    await vi.advanceTimersByTimeAsync(6_000);
    await flushMicrotasks();

    const failed = settleCalls("failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].patch?.failureCode).toBe("EXECUTION_STALLED");
    expect(
      vi.mocked(updateMessageStatus).mock.calls.some((c) => c[2] === "failed"),
    ).toBe(true);

    // The wedged loop finally returns, claiming success. It is fenced:
    // no completed settle and no transcript overwrite may land.
    vi.mocked(transitionActionRunEventActivity).mockClear();
    vi.mocked(updateMessageStatus).mockClear();
    resolveLoop({
      finalText: "done",
      stepsUsed: 3,
      toolCalls: [],
      cancelled: false,
      pendingApproval: undefined,
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2_000);
    await flushMicrotasks();
    expect(settleCalls("completed")).toHaveLength(0);
    expect(settleCalls("failed")).toHaveLength(0);
    expect(vi.mocked(updateMessageStatus).mock.calls).toHaveLength(0);
  });

  it("never fires while the resumed run keeps making progress", async () => {
    const res = await POST(makeRequest(), routeParams);
    expect(res.status).toBe(202);
    await flushMicrotasks();

    // 12 seconds of wall time (past the 5s stall bound) with a progress
    // event every 2 seconds: the watchdog must stay quiet.
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(2_000);
      capturedProgress?.emit({ type: "status", summary: "working" });
      await flushMicrotasks();
    }
    expect(settleCalls("failed")).toHaveLength(0);

    // The run completes normally and settles as completed.
    resolveLoop({
      finalText: "done",
      stepsUsed: 3,
      toolCalls: [],
      cancelled: false,
      pendingApproval: undefined,
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2_000);
    await flushMicrotasks();
    expect(settleCalls("completed")).toHaveLength(1);
    expect(
      settleCalls("failed").filter((a) => a.patch?.failureCode === "EXECUTION_STALLED"),
    ).toHaveLength(0);
  });
});
