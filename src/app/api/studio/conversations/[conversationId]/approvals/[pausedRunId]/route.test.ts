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
  appendActionEvent: vi.fn(() => Promise.resolve({})),
  recordActionEventActivity: vi.fn(() => Promise.resolve({})),
  transitionActionRun: vi.fn(() => Promise.resolve({})),
  transitionActionRunEventActivity: vi.fn(() => Promise.resolve({})),
}));

import { auth } from "@/lib/auth";
import { attachActionRunToConversationTask, settleConversationTask } from "@/lib/studio/task-service";
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
import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { resumeAgentLoopV2 } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { getCheckpoint } from "@/lib/missions/mission-repository";
import {
  getActionRun,
  appendActionEvent,
  transitionActionRunEventActivity,
} from "@/lib/action-runtime";
import {
  startQualityLoopSession,
  snapshotQualityLoopSession,
} from "@/lib/litt-intelligence/quality-loop-flow";
import { getProject } from "@/lib/projects/project-repository";
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
  it("refuses an expired approval without creating an executor", async () => {
    vi.mocked(getPausedRun).mockResolvedValue({ ...pendingRun, status: "expired" } as never);
    const response = await POST(makeRequest("approved"), routeParams);
    expect(response.status).toBe(409);
    expect(markRunProcessing).not.toHaveBeenCalled();
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
  });
  it("rejects approval for a changed workspace before executing", async () => {
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "different-workspace" } as never);
    const response = await POST(makeRequest("approved"), routeParams);
    expect(response.status).toBe(409);
    expect(markRunProcessing).not.toHaveBeenCalled();
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
  });

  it("ignores client replacements for the frozen operation", async () => {
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({ finalText: "Done", stepsUsed: 1, toolCalls: [], cancelled: false } as never);
    const request = new NextRequest(`http://localhost/api/studio/conversations/${CONV_ID}/approvals/${PAUSED_ID}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved", toolId: "terminal.execute", inputs: { command: "unapproved" }, operationId: "forged" }),
    });
    expect((await POST(request, routeParams)).status).toBe(202);
    await vi.waitFor(() => expect(resumeAgentLoopV2).toHaveBeenCalled());
    expect(vi.mocked(resumeAgentLoopV2).mock.calls[0][0]).toMatchObject({ toolId: pendingRun.toolId, inputs: pendingRun.inputs });
    await vi.waitFor(() => expect(settleCall("completed")).not.toBeNull());
  });
  it("does not mark a failed quality verdict completed", async () => {
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "Done.", stepsUsed: 3, toolCalls: [], cancelled: false,
      qualityLoop: { verdict: { ok: false, reasons: ["test evidence missing"] }, stages: [], designPasses: 0 },
    } as never);
    expect((await POST(makeRequest("approved"), routeParams)).status).toBe(202);
    await vi.waitFor(() => expect(settleCall("failed")).not.toBeNull());
    expect(settleCall("completed")).toBeNull();
    expect(settleConversationTask).toHaveBeenCalledWith("user_123", CONV_ID, "failed", false, "run-parent-1");
  });
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
    expect(attachActionRunToConversationTask).toHaveBeenCalledWith("user_123", CONV_ID, "run-parent-1");
    expect(settleConversationTask).toHaveBeenCalledWith("user_123", CONV_ID, "completed", false, "run-parent-1");
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

  it.each([
    ["image.stock", ["assets/hero.jpg"]],
    ["files.write", ["./assets/hero.jpg"]],
    ["files.write", ["assets\\hero.jpg"]],
    ["files.write", undefined],
  ])("settles on its own result after an asset-only %s mutation — the artifact gate guards site-file mutations only", async (toolId, paths) => {
    // Behavior change (LION-RUN-DIAGNOSIS-2026-11-16 Q1/F1b): the
    // artifact/preview gate used to run on ANY successful mutation, so
    // an asset-only resume into a still-untouched starter failed with
    // the welcome-screen error. That same overreach is what replaced a
    // successful image generation's reply with "No runnable website
    // entry file was created" on a real project. The gate now runs
    // only when the resumed run actually wrote site files; an
    // asset-only run settles on its own result, and the welcome-marker
    // protection still applies in full to site-file mutations (pinned
    // by the styles.css test below) and to the initial launch flow.
    const transport = await createWorkspaceTransport("ws-123", "user_123");
    Object.assign(transport, {
      readFile: vi.fn(async () => ({ content: '<html><body>LITT-WELCOME-SCREEN</body></html>' })),
    });
    vi.mocked(createWorkspaceTransport).mockResolvedValueOnce(transport);
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "Done", stepsUsed: 1, cancelled: false,
      toolCalls: [{ toolId, success: true, summary: "asset saved", mutating: true, paths }],
      workspaceChange: { status: "changed", changedPaths: ["assets/hero.jpg"] },
    } as never);
    expect((await POST(makeRequest("approved"), routeParams)).status).toBe(202);
    await vi.waitFor(() => expect(settleCall("completed")).not.toBeNull());
    expect(settleCall("failed")).toBeNull();
    // The gate never ran: no preview bring-up was attempted.
    expect(vi.mocked(transport.startPreview)).not.toHaveBeenCalled();
    expect(updateMessageStatus).toHaveBeenCalledWith(
      "msg-assistant-1",
      "user_123",
      "completed",
      "Done",
    );
  });

  it("keeps an image-only approved run's finalText as the reply — the artifact gate cannot replace it", async () => {
    // Production defect (2026-11-16 lion proof, build 280035ab): the
    // approved image.generate succeeded and the loop's finalText
    // carried the image markdown, but the settlement ran the website
    // artifact gate on the strength of that asset-only mutation; the
    // gate failed and its error sentence became the transcript reply,
    // discarding the image. The transport below lists NO entry file,
    // so the gate would fail deterministically if it ran at all.
    const transport = await createWorkspaceTransport("ws-123", "user_123");
    Object.assign(transport, {
      listFiles: vi.fn(async () => ({ entries: [{ name: "README.md", type: "file" }] })),
    });
    vi.mocked(createWorkspaceTransport).mockResolvedValueOnce(transport);
    const finalText = "Here is your lion: ![lion](https://cdn.test/lion.png)";
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText,
      stepsUsed: 2,
      cancelled: false,
      toolCalls: [{ toolId: "image.generate", success: true, summary: "generated", mutating: true }],
    } as any);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    await vi.waitFor(() => expect(settleCall("completed")).not.toBeNull());
    expect(settleCall("failed")).toBeNull();
    // The reply is the run's own finalText — image markdown intact,
    // not the gate's "No runnable website entry file…" sentence.
    expect(updateMessageStatus).toHaveBeenCalledWith(
      "msg-assistant-1",
      "user_123",
      "completed",
      finalText,
    );
    // The gate never ran: no artifact walk, no preview bring-up.
    expect(vi.mocked(transport.listFiles)).not.toHaveBeenCalled();
    expect(vi.mocked(transport.startPreview)).not.toHaveBeenCalled();
  });

  it("still fails a site-file mutation that leaves the workspace on the blank starter screen", async () => {
    // The welcome-marker protection survives the F1b scoping — for
    // runs that DID write site files. A files.write to a non-entry
    // site file (styles.css) is a site-file mutation, so the gate
    // runs, finds only the untouched welcome entry, and fails the run
    // honestly instead of reporting success on an unbuilt site.
    const transport = await createWorkspaceTransport("ws-123", "user_123");
    Object.assign(transport, {
      readFile: vi.fn(async () => ({ content: '<html><body>LITT-WELCOME-SCREEN</body></html>' })),
    });
    vi.mocked(createWorkspaceTransport).mockResolvedValueOnce(transport);
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "Done", stepsUsed: 1, cancelled: false,
      toolCalls: [{ toolId: "files.write", success: true, summary: "saved", mutating: true, paths: ["styles.css"] }],
    } as never);
    expect((await POST(makeRequest("approved"), routeParams)).status).toBe(202);
    await vi.waitFor(() => expect(settleCall("failed")).not.toBeNull());
    expect(settleCall("completed")).toBeNull();
    const failed = settleCall("failed");
    expect(failed!.args.patch?.failureMessage).toContain("blank starter screen");
  });

  it("still triggers preview readiness for a site-file mutation", async () => {
    // The other half of the F1b pin: a real site-file write keeps the
    // pre-change behavior — the artifact gate runs and the preview is
    // brought up before the run settles completed.
    const transport = await createWorkspaceTransport("ws-123", "user_123");
    vi.mocked(createWorkspaceTransport).mockResolvedValueOnce(transport);
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "Created index.html with the new hero.",
      stepsUsed: 3,
      toolCalls: [{ toolId: "files.write", success: true, summary: "saved", mutating: true, paths: ["index.html"] }],
      cancelled: false,
      pendingApproval: undefined,
    } as any);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    await vi.waitFor(() => expect(settleCall("completed")).not.toBeNull());
    expect(settleCall("failed")).toBeNull();
    expect(vi.mocked(transport.startPreview)).toHaveBeenCalled();
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

  it("names the failed tool and its error when the approved mutation fails", async () => {
    // Production defect (2026-11-08 staging acceptance, pausedRun
    // fa715c2e): an approved image.generate failed inside the provider
    // (Cloudflare schema rejection) and the run settled with the generic
    // "approved workspace operation failed" — the real reason was only
    // visible in server logs. The failure message must carry the tool id
    // and recorded error so users and acceptance evidence see the truth.
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "done",
      stepsUsed: 2,
      cancelled: false,
      toolCalls: [
        {
          toolId: "image.generate",
          success: false,
          summary:
            "Failed: Bad input: Additional or unevaluated properties '/width' at '/' not allowed",
          mutating: true,
        },
      ],
    } as any);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    await vi.waitFor(() => expect(settleCall("failed")).not.toBeNull());
    const failed = settleCall("failed");
    const failureMessage = failed!.args.patch?.failureMessage as string;
    expect(failureMessage).toContain("image.generate");
    expect(failureMessage).toContain("Bad input");
    expect(updateMessageStatus).toHaveBeenCalledWith(
      "msg-assistant-1",
      "user_123",
      "failed",
      expect.stringContaining("image.generate"),
    );
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
        toolId: "project.deploy",
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
        toolId: "project.deploy",
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

  it("persists a preview.ready event when a static resume's artifact check passes", async () => {
    // Diagnosis ART-20261111-061 §1: the static branch of
    // ensureProjectPreviewReady records NO action event, so on a resumed
    // static run nothing ever overwrites an earlier preview.failed in the
    // projection's latest-event-wins Preview facet. The route files the
    // preview evidence into the quality session — it must also persist
    // the ready fact into the action-event log it already owns.
    vi.mocked(getProject).mockResolvedValue({ framework: "static" } as any);
    const transport = await createWorkspaceTransport("ws-123", "user_123");
    Object.assign(transport, {
      readFile: vi.fn(async () => ({ content: "<html><body>Built site</body></html>" })),
    });
    vi.mocked(createWorkspaceTransport).mockResolvedValueOnce(transport);
    const qualityLoopState = snapshotQualityLoopSession(
      startQualityLoopSession({
        runId: "run-parent-1",
        projectId: "proj-123",
        userId: "user_123",
        userRequest: "Build a roofing site",
        isStaticWorkspace: true,
      }),
    );
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "Built the site.",
      stepsUsed: 2,
      cancelled: false,
      toolCalls: [
        { toolId: "files.write", success: true, summary: "saved", mutating: true, paths: ["index.html"] },
      ],
      workspaceChange: { status: "changed", changedPaths: ["index.html"] },
      qualityLoopState,
    } as any);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(202);

    await vi.waitFor(() =>
      expect(appendActionEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run-parent-1",
          userId: "user_123",
          type: "preview.ready",
          payload: expect.objectContaining({
            success: true,
            previewUrl: "/api/preview/proj-123/",
          }),
        }),
      ),
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

  it("refuses the resume when the recorded checkpoint row is missing (P0 R1 — no silent empty baseline)", async () => {
    // P0 R1 supersedes the pre-R1 legacy tolerance at this site: a
    // recorded checkpointId whose row is gone means the run's verified
    // baseline no longer exists. Continuing on a fabricated empty SHA
    // would settle the resumed run on unverified evidence, so the
    // resume refuses explicitly (409, run settled failed with the
    // reason) and the user restarts the request for a fresh checkpoint.
    vi.mocked(getPausedRun).mockResolvedValue({ ...pendingRun, checkpointId: "chk-gone" } as any);
    vi.mocked(resolvePausedRun).mockResolvedValue({
      ...pendingRun,
      checkpointId: "chk-gone",
      status: "approved",
    } as any);
    vi.mocked(getCheckpoint).mockResolvedValue(null);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.error).toContain("no verified baseline");
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
    const failed = settleCall("failed");
    expect(failed).not.toBeNull();
    expect(failed?.args.patch?.failureCode).toBe("CHECKPOINT_MISSING");
  });

  it("keeps the empty-SHA threading for a missing checkpoint row in a STATIC workspace (P0 R1)", async () => {
    // Static (gitless) workspaces never require a checkpoint — the
    // gitless read-back path verifies the run — so a stray recorded id
    // whose row is missing must not block the resume.
    const transport = await createWorkspaceTransport("ws-123", "user_123");
    Object.assign(transport, { isStaticWorkspace: true });
    vi.mocked(createWorkspaceTransport).mockResolvedValueOnce(transport);
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

  it("refuses the resume when the record carries a checkpoint creation failure (P0 R1)", async () => {
    // The loop recorded at pause time that checkpoint creation was
    // attempted and FAILED (checkpointFailure on the record) — the run
    // reported itself non-resumable, and the resume honors that
    // instead of continuing with no baseline at all.
    vi.mocked(getPausedRun).mockResolvedValue({
      ...pendingRun,
      checkpointId: null,
      checkpointFailure: "checkpoint store unavailable",
    } as any);
    vi.mocked(resolvePausedRun).mockResolvedValue({
      ...pendingRun,
      checkpointId: null,
      checkpointFailure: "checkpoint store unavailable",
      status: "approved",
    } as any);

    const res = await POST(makeRequest("approved"), routeParams);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.error).toContain("could not be created when it paused");
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
    expect(getCheckpoint).not.toHaveBeenCalled();
    const failed = settleCall("failed");
    expect(failed).not.toBeNull();
    expect(failed?.args.patch?.failureCode).toBe("CHECKPOINT_CREATION_FAILED");
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
