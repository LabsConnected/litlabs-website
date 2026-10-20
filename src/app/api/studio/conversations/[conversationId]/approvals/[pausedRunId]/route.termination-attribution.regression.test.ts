// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests — truthful termination attribution at the approvals
 * settle (Repair R4, Diagnosis E3-S1).
 *
 * The defect: the resume executor's terminal settle mapped ANY loop
 * result with cancelled=true to action_run status "cancelled" +
 * currentActivity "Task cancelled by user", never consulting
 * result.cancelReason. But the loop sets cancelled=true mostly for
 * NON-user stops — max steps, max output, repeated-call detection, the
 * zero-call stall, max runtime — so budget/stall stops were written
 * into the canonical ledger as user cancellations (and billed as
 * cancelled under the wrong reason). Only a loop stop whose reason is
 * the user-stop reason may settle as cancelled; every other loop stop
 * settles FAILED carrying its real reason. Billing is unchanged: both
 * settle 0 credits.
 *
 * Also covered: the GET poll contract surfaces the run's LIVE nested
 * gate (a different pausedRunId) at top level, so a polling client can
 * hand off to the new gate instead of parking in "executing" until the
 * 15-minute poll timeout (E1-F3).
 */

// ── Mocks (same harness family as route.verdict-persistence.regression.test.ts) ──

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
  listPausedRunsForActionRun: vi.fn(() => Promise.resolve([])),
  RUN_HEARTBEAT_MS: 30_000,
  resetRunForRetry: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("@/lib/litt-intelligence/workspace-transport", () => ({
  createWorkspaceTransport: vi.fn(() =>
    Promise.resolve({
      workspaceId: "ws-123",
      listFiles: vi.fn(async () => ({ entries: [] })),
      readFile: vi.fn(async () => { throw new Error("no files in this harness"); }),
      gitStatus: vi.fn(async () => { throw new Error("HOST_EXECUTION_DISABLED"); }),
      startPreview: vi.fn(async () => ({ status: "ready" })),
      getPreviewStatus: vi.fn(async () => ({ status: "ready" })),
    }),
  ),
}));

vi.mock("@/lib/litt-intelligence/agent-loop-v2", () => ({
  resumeAgentLoopV2: vi.fn(),
  isFileWritingTool: (id: string) => ["files.write", "apply_patch", "edit", "code.writeFile", "code.refactor", "files.patch"].includes(id),
}));

vi.mock("@/lib/litt-intelligence/launch-flow", () => ({
  ensureProjectPreviewReady: vi.fn(async () => ({ ok: true, files: ["index.html"] })),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(),
  getProject: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/lib/missions/mission-repository", () => ({
  getCheckpoint: vi.fn(() => Promise.resolve(null)),
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
  createActionRun: vi.fn(() => Promise.resolve({ id: "run-retry-1" })),
  appendActionEvent: vi.fn(() => Promise.resolve({})),
  recordActionEventActivity: vi.fn(() => Promise.resolve({})),
  transitionActionRun: vi.fn(() => Promise.resolve({})),
  transitionActionRunEventActivity: vi.fn(() => Promise.resolve({})),
}));

import { auth } from "@/lib/auth";
import { POST, GET } from "./route";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
  getRunOutcomeForPausedRun,
  listPausedRunsForActionRun,
} from "@/lib/litt-intelligence/paused-run-store";
import { resumeAgentLoopV2 } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { getActionRun, transitionActionRunEventActivity } from "@/lib/action-runtime";
import { getAwaitingApprovalAssistantMessage, updateMessageStatus } from "@/lib/studio/conversation-service";
import { settleRun } from "@/lib/agent-billing";
import { getActiveExecution } from "@/lib/studio/execution-registry";

// ── Helpers ──

const CONV_ID = "conv-123";

function makeRequest(pausedRunId: string, decision: "approved" | "rejected"): NextRequest {
  return new NextRequest(
    `http://localhost/api/studio/conversations/${CONV_ID}/approvals/${pausedRunId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    },
  );
}

function makeGetRequest(pausedRunId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/studio/conversations/${CONV_ID}/approvals/${pausedRunId}`,
    { method: "GET" },
  );
}

function paramsFor(pausedRunId: string) {
  return { params: Promise.resolve({ conversationId: CONV_ID, pausedRunId }) };
}

function gateRecord(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: "user_123",
    conversationId: CONV_ID,
    projectId: "proj-123",
    workspaceId: "ws-123",
    toolId: "files.write",
    toolCallId: `tc-${id}`,
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
    ...overrides,
  };
}

const awaitingMessage = {
  id: "msg-assistant-1",
  role: "assistant",
  content: "I need approval to write files.",
  status: "awaiting_approval",
};

function stageGate(record: ReturnType<typeof gateRecord>, resolvedStatus: string) {
  vi.mocked(getPausedRun).mockResolvedValue(record as any);
  vi.mocked(resolvePausedRun).mockResolvedValue({ ...record, status: resolvedStatus } as any);
}

const TERMINAL_STATUSES = ["failed", "cancelled", "completed"];

/** POST one approval and wait for the detached executor's terminal settle. */
async function approveAndSettle(id: string) {
  const callsBefore = vi.mocked(transitionActionRunEventActivity).mock.calls.length;
  const res = await POST(makeRequest(id, "approved"), paramsFor(id));
  expect(res.status).toBe(202);
  let settle: Record<string, any> | null = null;
  await vi.waitFor(() => {
    const calls = vi.mocked(transitionActionRunEventActivity).mock.calls.slice(callsBefore);
    const hit = calls.find((c) => TERMINAL_STATUSES.includes((c[0] as { status?: string }).status ?? ""));
    expect(hit).toBeTruthy();
    settle = hit![0] as Record<string, any>;
  });
  await vi.waitFor(() => expect(getActiveExecution(CONV_ID)).toBeNull());
  return settle!;
}

function billingSettles(): Array<Record<string, any>> {
  return vi.mocked(settleRun).mock.calls.map((c) => c[1] as Record<string, any>);
}

// ── Tests ──

describe("POST /approvals/[pausedRunId] — termination attribution (R4/E3-S1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "waiting_for_user" } as any);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as any);
    vi.mocked(markRunProcessing).mockResolvedValue(true as any);
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue(awaitingMessage as any);
  });

  it("(a1) a loop stop with cancelReason 'Max steps reached (50)' settles FAILED with its real reason — never 'Task cancelled by user'", async () => {
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "I stopped before finishing: Max steps reached (50). Nothing further was changed.",
      stepsUsed: 50,
      toolCalls: [],
      cancelled: true,
      cancelReason: "Max steps reached (50)",
    } as any);
    stageGate(gateRecord("paused-1"), "approved");

    const settle = await approveAndSettle("paused-1");

    // The canonical record must tell the truth: a budget stop is a
    // failed/stopped run carrying its reason, not a user cancellation.
    expect(settle.status).toBe("failed");
    expect(settle.eventType).toBe("run.failed");
    expect(settle.patch.currentActivity).toContain("Max steps reached (50)");
    expect(settle.patch.currentActivity).not.toBe("Task cancelled by user");
    expect(settle.patch.failureMessage).toContain("Max steps reached (50)");
    // The RunResult keeps the loop's own account of the stop.
    expect(settle.payload.result.cancelled).toBe(true);
    expect(settle.payload.result.cancelReason).toBe("Max steps reached (50)");
    // Transcript truth matches the record (not "cancelled").
    expect(updateMessageStatus).toHaveBeenCalledWith(
      "msg-assistant-1",
      "user_123",
      "failed",
      expect.anything(),
    );
    // Billing semantics unchanged: a stopped run debits zero — as a
    // FAILED settle now, not a cancelled one.
    expect(billingSettles()).toContainEqual(
      expect.objectContaining({ status: "failed", actualCredits: 0 }),
    );
    expect(billingSettles()).not.toContainEqual(
      expect.objectContaining({ status: "cancelled" }),
    );
  });

  it("(a2) a genuine user stop (cancelReason 'Cancelled by user') still settles cancelled as 'Task cancelled by user'", async () => {
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "",
      stepsUsed: 3,
      toolCalls: [],
      cancelled: true,
      cancelReason: "Cancelled by user",
    } as any);
    stageGate(gateRecord("paused-1"), "approved");

    const settle = await approveAndSettle("paused-1");

    expect(settle.status).toBe("cancelled");
    expect(settle.eventType).toBe("run.cancelled");
    expect(settle.patch.currentActivity).toBe("Task cancelled by user");
    expect(billingSettles()).toContainEqual(
      expect.objectContaining({ status: "cancelled", actualCredits: 0 }),
    );
  });

  it("(a3) a zero-tool-call stall settles FAILED with the stall reason, not as a user cancellation", async () => {
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "I stopped mid-build: I announced more work but could not produce the next actions.",
      stepsUsed: 4,
      toolCalls: [],
      cancelled: true,
      cancelReason:
        "The model announced further work but produced no tool calls after retrying; stopping instead of claiming the build is complete.",
    } as any);
    stageGate(gateRecord("paused-1"), "approved");

    const settle = await approveAndSettle("paused-1");

    expect(settle.status).toBe("failed");
    expect(settle.eventType).toBe("run.failed");
    expect(settle.patch.currentActivity).not.toBe("Task cancelled by user");
    expect(settle.patch.currentActivity).toContain("produced no tool calls");
  });
});

describe("GET /approvals/[pausedRunId] — live nested gate on the poll contract (R4/E1-F3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
  });

  it("(d-server) while this gate's outcome still reads processing, the GET names the run's LIVE nested gate at top level", async () => {
    // Gate 1 was approved and its segment re-paused at gate 2. Gate 1's
    // own derived outcome can lag (its handoff event outside the read
    // window) — the poll contract must still tell the client the server
    // is waiting on gate 2, or the card parks in "executing" for up to
    // the 15-minute poll timeout while the server waits on the user.
    vi.mocked(getPausedRun).mockResolvedValue(gateRecord("paused-1", { status: "approved" }) as any);
    vi.mocked(getRunOutcomeForPausedRun).mockResolvedValue({
      runStatus: "processing",
      runResult: null,
      runError: null,
      runStartedAt: new Date().toISOString(),
      runCompletedAt: null,
    } as any);
    vi.mocked(listPausedRunsForActionRun).mockResolvedValue([
      gateRecord("paused-2", { status: "pending", toolId: "files.write", reason: "Mutation requires approval in ACT mode" }),
      gateRecord("paused-1", { status: "approved" }),
    ] as any);

    const res = await GET(makeGetRequest("paused-1"), paramsFor("paused-1"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.runStatus).toBe("processing");
    expect(body.pendingApproval).toMatchObject({
      toolId: "files.write",
      pausedRunId: "paused-2",
    });
  });

  it("(d-server) no live sibling gate → pendingApproval stays null (no fabricated handoff)", async () => {
    vi.mocked(getPausedRun).mockResolvedValue(gateRecord("paused-1", { status: "approved" }) as any);
    vi.mocked(getRunOutcomeForPausedRun).mockResolvedValue({
      runStatus: "processing",
      runResult: null,
      runError: null,
      runStartedAt: new Date().toISOString(),
      runCompletedAt: null,
    } as any);
    vi.mocked(listPausedRunsForActionRun).mockResolvedValue([
      gateRecord("paused-1", { status: "approved" }),
    ] as any);

    const res = await GET(makeGetRequest("paused-1"), paramsFor("paused-1"));
    const body = await res.json();
    expect(body.pendingApproval ?? null).toBeNull();
  });
});
