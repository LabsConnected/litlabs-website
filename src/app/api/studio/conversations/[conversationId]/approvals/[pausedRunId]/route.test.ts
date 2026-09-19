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
 *     message (status → completed) BEFORE markRunCompleted, so a polling
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
  markRunCompleted: vi.fn(() => Promise.resolve()),
  markRunFailed: vi.fn(() => Promise.resolve()),
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

vi.mock("@/lib/studio/conversation-service", () => ({
  getAwaitingApprovalAssistantMessage: vi.fn(),
  insertMessage: vi.fn(),
  updateMessageStatus: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/lib/studio/logger", () => ({
  studioLog: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { POST } from "./route";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
  markRunCompleted,
  markRunFailed,
  createPausedRun,
} from "@/lib/litt-intelligence/paused-run-store";
import { resumeAgentLoopV2 } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
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
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as any);
    vi.mocked(markRunProcessing).mockResolvedValue(true);
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue(awaitingMessage as any);
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

    await vi.waitFor(() => expect(markRunCompleted).toHaveBeenCalled());

    // The paused message becomes the completed reply — the real outcome,
    // not a fabricated regeneration.
    expect(updateMessageStatus).toHaveBeenCalledWith(
      "msg-assistant-1",
      "user_123",
      "completed",
      "Created index.html with the new hero.",
    );
    // Transcript writeback ran BEFORE the run was marked completed.
    const writeOrder = vi.mocked(updateMessageStatus).mock.invocationCallOrder[0];
    const completeOrder = vi.mocked(markRunCompleted).mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(completeOrder);
    // No separate assistant message was inserted — the awaiting one was reused.
    expect(insertMessage).not.toHaveBeenCalled();
  });

  it("marks the awaiting message failed when the resumed run throws", async () => {
    vi.mocked(resumeAgentLoopV2).mockRejectedValue(new Error("provider exploded"));

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    await vi.waitFor(() => expect(markRunFailed).toHaveBeenCalled());
    expect(updateMessageStatus).toHaveBeenCalledWith(
      "msg-assistant-1",
      "user_123",
      "failed",
      "The resumed run failed: provider exploded",
    );
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

    await vi.waitFor(() => expect(markRunCompleted).toHaveBeenCalled());

    // The nested gate is a REAL paused run — resumable, not a dead end.
    expect(createPausedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONV_ID,
        toolId: "deploy.production",
        toolCallId: "tc-9",
      }),
    );
    const runResult = vi.mocked(markRunCompleted).mock.calls[0][2] as {
      pendingApproval?: { pausedRunId?: string };
    };
    expect(runResult.pendingApproval?.pausedRunId).toBe("paused-2");
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

    await vi.waitFor(() => expect(markRunCompleted).toHaveBeenCalled());
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
