// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests for Repair R1a-3 — per-conversation executor
 * serialization (Diagnosis E2 S2, ART-20261020-039).
 *
 * The defect: the approvals route's detached resume executor never
 * registered in lib/studio/execution-registry, so two DISTINCT pending
 * gates of one conversation could each spawn a detached resume loop —
 * two executors interleaving on one conversation lineage (each with its
 * own claim, its own reservation), racing on the same workspace and the
 * same parent run record. The messages route has always serialized its
 * executions per conversation through this registry; approval executors
 * were invisible to it.
 *
 * These tests pin the repair: the first approval registers its executor
 * for its lifetime; a second approval POST for a DIFFERENT pending gate
 * of the same conversation returns the live run's status (202,
 * EXECUTION_ALREADY_ACTIVE) WITHOUT resolving that gate or spawning a
 * second executor; once the live executor settles, the second gate can
 * be approved normally.
 */

// ── Mocks (mirrors route.resume-stall-watchdog.regression.test.ts) ──
// NOTE: @/lib/studio/execution-registry is deliberately NOT mocked —
// the real registry is the mechanism under test.

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
  getRunOutcomeForPausedRun: vi.fn(() =>
    Promise.resolve({ runStatus: null, runResult: null, runError: null, runStartedAt: null, runCompletedAt: null })),
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
import { POST } from "./route";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
} from "@/lib/litt-intelligence/paused-run-store";
import { resumeAgentLoopV2 } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { getActionRun } from "@/lib/action-runtime";
import { getAwaitingApprovalAssistantMessage } from "@/lib/studio/conversation-service";
import {
  getActiveExecution,
  resetExecutionRegistryForTests,
} from "@/lib/studio/execution-registry";

// ── Helpers ──

const CONV_ID = "conv-serial";
const GATE_A = "paused-a";
const GATE_B = "paused-b";

function makeRequest(pausedRunId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/studio/conversations/${CONV_ID}/approvals/${pausedRunId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    },
  );
}

const paramsFor = (pausedRunId: string) => ({
  params: Promise.resolve({ conversationId: CONV_ID, pausedRunId }),
});

function pendingGate(id: string, toolId: string) {
  return {
    id,
    userId: "user_123",
    conversationId: CONV_ID,
    projectId: "proj-123",
    workspaceId: "ws-123",
    toolId,
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
  };
}

const gateA = pendingGate(GATE_A, "files.write");
const gateB = pendingGate(GATE_B, "files.write");

const awaitingMessage = {
  id: "msg-assistant-1",
  role: "assistant",
  content: "I need approval to write a file.",
  status: "awaiting_approval",
};

describe("POST /approvals/[pausedRunId] — per-conversation executor serialization (R1a-3)", () => {
  let releaseLoop: ((result: unknown) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    resetExecutionRegistryForTests();
    releaseLoop = null;
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
    vi.mocked(getPausedRun).mockImplementation(async (id: string) =>
      (id === GATE_A ? gateA : gateB) as any);
    vi.mocked(resolvePausedRun).mockImplementation(async (id: string) =>
      ({ ...(id === GATE_A ? gateA : gateB), status: "approved" }) as any);
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "waiting_for_user" } as any);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as any);
    vi.mocked(markRunProcessing).mockResolvedValue(true);
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue(awaitingMessage as any);
    // The live executor: its loop promise stays unsettled until the
    // test releases it — the executor is genuinely mid-run.
    vi.mocked(resumeAgentLoopV2).mockImplementation(
      () => new Promise((resolve) => { releaseLoop = resolve as never; }) as never,
    );
  });

  afterEach(() => {
    resetExecutionRegistryForTests();
  });

  it("a second gate's approval returns the live run's status instead of spawning a second executor", async () => {
    // Gate A approved: executor spawns and stays live.
    const resA = await POST(makeRequest(GATE_A), paramsFor(GATE_A));
    expect(resA.status).toBe(202);
    expect(resumeAgentLoopV2).toHaveBeenCalledTimes(1);
    expect(getActiveExecution(CONV_ID)?.key).toBe(`approval:${GATE_A}`);

    // Gate B approved while A's executor is live: NO second executor,
    // and gate B's decision must NOT be consumed (it stays pending).
    // Pre-fix this fails: B resolved its gate and spawned executor #2.
    const resB = await POST(makeRequest(GATE_B), paramsFor(GATE_B));
    expect(resB.status).toBe(202);
    const bodyB = (await resB.json()) as { code?: string; runStatus?: string; resolved?: boolean };
    expect(bodyB.code).toBe("EXECUTION_ALREADY_ACTIVE");
    expect(bodyB.runStatus).toBe("processing");
    expect(resumeAgentLoopV2).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolvePausedRun).mock.calls.map((c) => c[0])).toEqual([GATE_A]);
  });

  it("once the live executor settles, the second gate approves and executes normally", async () => {
    const resA = await POST(makeRequest(GATE_A), paramsFor(GATE_A));
    expect(resA.status).toBe(202);
    expect(getActiveExecution(CONV_ID)).not.toBeNull();

    // Executor A finishes (a plain completed segment).
    releaseLoop!({
      finalText: "Done.",
      stepsUsed: 1,
      toolCalls: [],
      cancelled: false,
      pendingApproval: undefined,
    });
    await vi.waitFor(() => expect(getActiveExecution(CONV_ID)).toBeNull());

    // Gate B can now be approved: it resolves and spawns its executor.
    const resB = await POST(makeRequest(GATE_B), paramsFor(GATE_B));
    expect(resB.status).toBe(202);
    const bodyB = (await resB.json()) as { code?: string; status?: string };
    expect(bodyB.code).toBeUndefined();
    expect(bodyB.status).toBe("processing");
    expect(resumeAgentLoopV2).toHaveBeenCalledTimes(2);
    expect(vi.mocked(resolvePausedRun).mock.calls.map((c) => c[0])).toEqual([GATE_A, GATE_B]);
    expect(getActiveExecution(CONV_ID)?.key).toBe(`approval:${GATE_B}`);

    // Let B's executor settle too so nothing dangles past the test.
    releaseLoop!({
      finalText: "Done.",
      stepsUsed: 1,
      toolCalls: [],
      cancelled: false,
      pendingApproval: undefined,
    });
    await vi.waitFor(() => expect(getActiveExecution(CONV_ID)).toBeNull());
  });
});
