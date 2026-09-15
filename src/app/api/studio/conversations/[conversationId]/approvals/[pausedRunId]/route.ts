import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
  markRunCompleted,
  markRunFailed,
  createPausedRun,
  type RunResult,
} from "@/lib/litt-intelligence/paused-run-store";
import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { resumeAgentLoopV2, type AgentLoopConfig } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import {
  getAwaitingApprovalAssistantMessage,
  insertMessage,
  updateMessageStatus,
} from "@/lib/studio/conversation-service";
import { studioLog } from "@/lib/studio/logger";
import type { MessageStatus } from "@/lib/studio/types";

/**
 * Write a resumed run's outcome back onto the conversation transcript.
 * The assistant message that paused stays "awaiting_approval" until the
 * resumed execution finishes — without this writeback a page refresh would
 * show a run that never resolved. If the original message can't be found
 * (deleted conversation etc.), the result is appended as a new message so
 * the work isn't invisible. Best-effort: the authoritative outcome is
 * already durable on the paused-run row itself.
 */
async function writeResumedResultToTranscript(opts: {
  conversationId: string;
  userId: string;
  projectId: string;
  pausedRunId: string;
  status: MessageStatus;
  content?: string;
}): Promise<void> {
  try {
    const awaiting = await getAwaitingApprovalAssistantMessage(opts.conversationId, opts.userId);
    if (awaiting) {
      await updateMessageStatus(awaiting.id, opts.userId, opts.status, opts.content);
      return;
    }
    if (opts.content?.trim()) {
      await insertMessage({
        conversationId: opts.conversationId,
        ownerId: opts.userId,
        projectId: opts.projectId,
        role: "assistant",
        content: opts.content,
        status: opts.status,
        clientRequestId: `resume:${opts.pausedRunId}`,
      });
    }
  } catch (err) {
    studioLog("approval:transcript_writeback_failed", {
      conversationId: opts.conversationId,
      userId: opts.userId,
      pausedRunId: opts.pausedRunId,
      errorClass: err instanceof Error ? err.message : "unknown",
    });
  }
}

/**
 * POST /api/studio/conversations/[conversationId]/approvals/[pausedRunId]
 *
 * Resolve a V2 agent loop paused approval. Server-authoritative.
 *
 * Body: { decision: "approved" | "rejected", reason?: string }
 *
 * On APPROVE:
 *   - Revalidate user ownership and workspace
 *   - Re-run permission validation
 *   - Persist the approval decision (single-use, atomic)
 *   - Start the resumed execution DETACHED from this HTTP request
 *   - Return 202 Accepted with { resolved: true, status: "processing" }
 *
 * The client polls GET /approvals/[pausedRunId] for run_status until
 * "completed" or "failed".
 *
 * Security:
 * - Never accepts replacement tool arguments
 * - Never trusts client-supplied paused state
 * - Approvals are single-use and expiring (5 min TTL)
 * - Re-verifies workspace ownership on resume
 * - Idempotent: repeated approval requests return 202 without
 *   launching duplicate executions
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string; pausedRunId: string }> },
) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId, pausedRunId } = await params;

  let body: { decision?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be 'approved' or 'rejected'" },
      { status: 400 },
    );
  }

  // 1. Get the paused run — server-side state only
  const pausedRun = await getPausedRun(pausedRunId, userId);
  if (!pausedRun) {
    return NextResponse.json({ error: "Approval not found or expired" }, { status: 404 });
  }

  if (pausedRun.status !== "pending") {
    // Already resolved — check if the execution is still running
    // This is the idempotent path: a repeated approval request returns 202
    // with the current run status instead of launching a duplicate.
    if (pausedRun.status === "approved" || pausedRun.status === "rejected") {
      return NextResponse.json({
        resolved: true,
        decision: pausedRun.status,
        status: pausedRun.runStatus ?? "processing",
        pausedRunId,
        runStatus: pausedRun.runStatus,
        runError: pausedRun.runError,
      }, { status: 202 });
    }
    return NextResponse.json(
      { error: `Approval already ${pausedRun.status}` },
      { status: 409 },
    );
  }

  // 2. Verify conversation ownership
  if (pausedRun.conversationId !== conversationId) {
    return NextResponse.json({ error: "Conversation mismatch" }, { status: 403 });
  }

  // 3. Resolve the approval (single-use, atomic)
  const resolved = await resolvePausedRun(pausedRunId, userId, body.decision);
  if (!resolved) {
    return NextResponse.json(
      { error: "Approval could not be resolved (expired or already resolved)" },
      { status: 409 },
    );
  }

  // 4. For REJECTED: no resumed execution needed — return immediately.
  // Close out the awaiting transcript message so a refresh doesn't show a
  // gate that was already decided.
  if (body.decision === "rejected") {
    const awaiting = await getAwaitingApprovalAssistantMessage(conversationId, userId);
    if (awaiting) {
      await updateMessageStatus(
        awaiting.id,
        userId,
        "completed",
        `${awaiting.content || "Approval was required."}\n\nDeclined — the gated action was not performed.`,
      ).catch(() => undefined);
    }
    return NextResponse.json({
      resolved: true,
      decision: "rejected",
      status: "completed",
      pausedRunId,
    });
  }

  // 5. For APPROVED: validate workspace, then start detached execution
  let transport;
  try {
    transport = await createWorkspaceTransport(resolved.projectId, userId);
  } catch {
    await markRunFailed(pausedRunId, userId, "Workspace is no longer available");
    return NextResponse.json(
      {
        error:
          "Workspace is no longer available or you no longer have access. The approval has been recorded but the operation cannot proceed.",
        resolved: true,
        status: "failed",
        pausedRunId,
      },
      { status: 409 },
    );
  }

  // 6. Verify workspace hasn't changed in a way that invalidates the approval
  try {
    const verified = await verifyProjectWorkspace(resolved.projectId, userId);
    if (verified.workspaceId !== resolved.workspaceId) {
      await markRunFailed(pausedRunId, userId, "Workspace changed since approval");
      return NextResponse.json(
        {
          error:
            "Workspace has changed since the approval was requested. Please retry the operation.",
          resolved: true,
          status: "failed",
          pausedRunId,
        },
        { status: 409 },
      );
    }
  } catch {
    await markRunFailed(pausedRunId, userId, "Workspace verification failed on resume");
    return NextResponse.json(
      { error: "Workspace verification failed on resume", resolved: true, status: "failed" },
      { status: 500 },
    );
  }

  // 7. Mark the run as "processing" (atomic — prevents duplicate executions)
  const started = await markRunProcessing(pausedRunId, userId);
  if (!started) {
    // Another request already started the execution — return current status
    const current = await getPausedRun(pausedRunId, userId);
    return NextResponse.json({
      resolved: true,
      decision: "approved",
      status: current?.runStatus ?? "processing",
      pausedRunId,
      runStatus: current?.runStatus ?? "processing",
    }, { status: 202 });
  }

  // 8. Start the resumed execution DETACHED from this HTTP request.
  // Railway's long-running Node process keeps this promise alive after
  // the response is sent. The result is persisted to the DB so the client
  // can poll GET for completion.
  const resumeConfig: Partial<AgentLoopConfig> = {
    systemPrompt: resolved.systemPrompt,
    executionMode: resolved.executionMode,
    enableBuildFix: true,
  };

  // Fire-and-forget with proper error handling — NOT a floating promise.
  // The .then/.catch chain persists the result/error to the DB.
  void resumeAgentLoopV2(
    {
      pausedMessages: resolved.pausedMessages,
      toolId: resolved.toolId,
      toolCallId: resolved.toolCallId,
      inputs: resolved.inputs, // Frozen from pause time — never from client
      decision: body.decision as "approved" | "rejected",
      rejectionReason: body.reason,
      config: resumeConfig,
      stepsUsedBeforePause: 0,
      hadInterveningMutation: false,
      existingCheckpoint: resolved.checkpointId
        ? { checkpointId: resolved.checkpointId, label: "pre-approval", gitSha: "" }
        : undefined,
    },
    transport,
  )
    .then(async (result) => {
      // The resumed run can hit a NEW approval gate. Persist it so it is
      // resumable — otherwise the client would get an approval with no
      // pausedRunId (a dead button).
      let nestedPausedRunId: string | undefined;
      if (result.pendingApproval) {
        try {
          const nested = await createPausedRun({
            userId,
            conversationId,
            projectId: resolved.projectId,
            workspaceId: resolved.workspaceId,
            toolId: result.pendingApproval.toolId,
            toolCallId: result.pendingApproval.toolCallId,
            inputs: result.pendingApproval.inputs,
            reason: result.pendingApproval.reason,
            pausedMessages: result.pendingApproval.pausedMessages,
            executionMode: resolved.executionMode,
            systemPrompt: resolved.systemPrompt,
            checkpointId: null,
          });
          nestedPausedRunId = nested.id;
        } catch (nestedErr) {
          studioLog("approval:nested_paused_run_persist_failed", {
            conversationId,
            userId,
            tool: result.pendingApproval.toolId,
            errorClass: nestedErr instanceof Error ? nestedErr.message : "unknown",
          });
        }
      }

      // Reflect the outcome on the transcript BEFORE marking the run
      // completed — a poller that sees "completed" can then loadMessages
      // and get the real persisted result.
      await writeResumedResultToTranscript({
        conversationId,
        userId,
        projectId: resolved.projectId,
        pausedRunId,
        status: result.cancelled
          ? "cancelled"
          : result.pendingApproval
            ? "awaiting_approval"
            : "completed",
        content: result.finalText || undefined,
      });

      const runResult: RunResult = {
        finalText: result.finalText,
        stepsUsed: result.stepsUsed,
        toolCalls: result.toolCalls,
        cancelled: result.cancelled,
        cancelReason: result.cancelReason,
        pendingApproval: result.pendingApproval
          ? {
              toolId: result.pendingApproval.toolId,
              pausedRunId: nestedPausedRunId,
              reason: result.pendingApproval.reason,
            }
          : undefined,
      };
      return markRunCompleted(pausedRunId, userId, runResult);
    })
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : "Resume failed";
      await writeResumedResultToTranscript({
        conversationId,
        userId,
        projectId: resolved.projectId,
        pausedRunId,
        status: "failed",
        content: `The resumed run failed: ${message}`,
      });
      return markRunFailed(pausedRunId, userId, message);
    });

  // 9. Return 202 Accepted immediately — the execution continues in the background
  return NextResponse.json({
    resolved: true,
    decision: "approved",
    status: "processing",
    pausedRunId,
    runStatus: "processing",
  }, { status: 202 });
}

/**
 * GET /api/studio/conversations/[conversationId]/approvals/[pausedRunId]
 * Get the status of a paused run, including async execution state.
 *
 * Returns:
 *   - status: "pending" | "approved" | "rejected" | "expired"
 *   - runStatus: null | "processing" | "completed" | "failed"
 *   - runResult: the resumed execution result (when completed)
 *   - runError: error message (when failed)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string; pausedRunId: string }> },
) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { pausedRunId } = await params;
  const pausedRun = await getPausedRun(pausedRunId, userId);
  if (!pausedRun) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: pausedRun.id,
    toolId: pausedRun.toolId,
    inputs: pausedRun.inputs,
    reason: pausedRun.reason,
    status: pausedRun.status,
    expiresAt: pausedRun.expiresAt,
    createdAt: pausedRun.createdAt,
    runStatus: pausedRun.runStatus,
    runResult: pausedRun.runResult,
    runError: pausedRun.runError,
    runStartedAt: pausedRun.runStartedAt,
    runCompletedAt: pausedRun.runCompletedAt,
  });
}
