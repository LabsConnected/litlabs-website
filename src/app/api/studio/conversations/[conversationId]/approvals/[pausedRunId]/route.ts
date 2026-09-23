import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import {
  getPausedRun,
  resolvePausedRun,
  resetRunForRetry,
  markRunProcessing,
  markRunCompleted,
  markRunFailed,
  createPausedRun,
  renewRunLease,
  RUN_HEARTBEAT_MS,
  type PausedRunRecord,
  type RunResult,
} from "@/lib/litt-intelligence/paused-run-store";
import { ProgressEmitter } from "@/lib/litt-intelligence/progress-events";
import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { resumeAgentLoopV2, type AgentLoopConfig } from "@/lib/litt-intelligence/agent-loop-v2";
import { resolveAvailableCapabilities } from "@/lib/litt-intelligence/capabilities";
import { ensureProjectPreviewReady } from "@/lib/litt-intelligence/launch-flow";
import { buildPreviewProxyUrl } from "@/lib/terminal-internal-client";
import {
  finalizeQualityLoop,
  noteBuildArtifacts,
  notePreviewReady,
  restoreQualityLoopSession,
  shouldEnableQualityLoop,
  snapshotQualityLoopSession,
} from "@/lib/litt-intelligence/quality-loop-flow";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import {
  getAwaitingApprovalAssistantMessage,
  insertMessage,
  updateMessageStatus,
} from "@/lib/studio/conversation-service";
import { studioLog } from "@/lib/studio/logger";
import {
  transitionActionRun,
  transitionActionRunEventActivity,
  type ActionRunPatch,
  type ActionRunStatus,
} from "@/lib/action-runtime";
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

async function settleParentActionRun(
  record: PausedRunRecord,
  status: ActionRunStatus,
  patch: ActionRunPatch,
  logEvent: string,
  eventType?: "approval.approved" | "approval.rejected",
): Promise<void> {
  if (!record.actionRunId) return;
  try {
    if (eventType) {
      await transitionActionRunEventActivity({
        runId: record.actionRunId,
        userId: record.userId,
        status,
        eventType,
        payload: { pausedRunId: record.id, toolId: record.toolId },
        message: patch.currentActivity ?? `Approval ${status}`,
        patch,
      });
    } else {
      await transitionActionRun(record.actionRunId, record.userId, status, patch);
    }
  } catch (error) {
    studioLog(logEvent, {
      conversationId: record.conversationId,
      userId: record.userId,
      pausedRunId: record.id,
      actionRunId: record.actionRunId,
      status,
      errorClass: error instanceof Error ? error.message : "unknown",
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
 * - Approvals are single-use and expiring (30 min TTL)
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

  // Set when this POST is a controlled retry of an approved run whose
  // execution failed: the existing record is reused as the resolved
  // approval instead of calling resolvePausedRun (single-use).
  let retriedApproval: PausedRunRecord | null = null;

  if (pausedRun.status !== "pending") {
    // Already resolved — check if the execution is still running
    // This is the idempotent path: a repeated approval request returns 202
    // with the current run status instead of launching a duplicate.
    //
    // Controlled retry: an approved run whose execution FAILED can be
    // re-run from THIS record (no new approval, no new billing operation —
    // the shared image service replays on the stable requestId). Only a
    // repeat "approved" decision on an approved+failed run retries; every
    // other already-resolved state returns the current status idempotently.
    if (
      body.decision === "approved" &&
      pausedRun.status === "approved" &&
      pausedRun.runStatus === "failed"
    ) {
      const retried = await resetRunForRetry(pausedRunId, userId);
      if (retried) {
        retriedApproval = pausedRun;
      } else {
        // Lost a race with another retry request — report current state.
        const current = await getPausedRun(pausedRunId, userId);
        return NextResponse.json({
          resolved: true,
          decision: "approved",
          status: current?.runStatus ?? "processing",
          pausedRunId,
          runStatus: current?.runStatus,
          runError: current?.runError,
        }, { status: 202 });
      }
    } else if (pausedRun.status === "approved" || pausedRun.status === "rejected") {
      return NextResponse.json({
        resolved: true,
        decision: pausedRun.status,
        status: pausedRun.runStatus ?? "processing",
        pausedRunId,
        runStatus: pausedRun.runStatus,
        runError: pausedRun.runError,
      }, { status: 202 });
    } else {
      return NextResponse.json(
        { error: `Approval already ${pausedRun.status}` },
        { status: 409 },
      );
    }
  }

  // 2. Verify conversation ownership
  if (pausedRun.conversationId !== conversationId) {
    return NextResponse.json({ error: "Conversation mismatch" }, { status: 403 });
  }

  // 3. Resolve the approval (single-use, atomic). A controlled retry
  // reuses the existing record — the approval was already granted.
  const resolved =
    retriedApproval ?? (await resolvePausedRun(pausedRunId, userId, body.decision));
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
    await settleParentActionRun(
      resolved,
      "cancelled",
      {
        currentActivity: "Approval declined — task cancelled",
        approvalReference: null,
      },
      "approval:action_run_reject_settle_failed",
      "approval.rejected",
    );
    return NextResponse.json({
      resolved: true,
      decision: "rejected",
      status: "completed",
      pausedRunId,
    });
  }

  // 5. For APPROVED: validate workspace, then start detached execution.
  // The approved operation's identity rides the transport so tools with
  // idempotent side effects (image.generate billing) derive a stable
  // operation key from it — a retried approval replays, never double-debits.
  let transport;
  try {
    transport = await createWorkspaceTransport(resolved.projectId, userId, {
      operationId: pausedRunId,
    });
  } catch {
    await markRunFailed(pausedRunId, userId, "Workspace is no longer available");
    await settleParentActionRun(
      resolved,
      "failed",
      { currentActivity: "Workspace is no longer available", failureCode: "WORKSPACE_UNAVAILABLE", failureMessage: "Workspace is no longer available" },
      "approval:action_run_workspace_settle_failed",
    );
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
      await settleParentActionRun(
        resolved,
        "failed",
        { currentActivity: "Workspace changed since approval", failureCode: "WORKSPACE_CHANGED", failureMessage: "Workspace changed since approval" },
        "approval:action_run_workspace_change_settle_failed",
      );
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
    await settleParentActionRun(
      resolved,
      "failed",
      { currentActivity: "Workspace verification failed on resume", failureCode: "WORKSPACE_VERIFICATION_FAILED", failureMessage: "Workspace verification failed on resume" },
      "approval:action_run_workspace_verify_settle_failed",
    );
    return NextResponse.json(
      { error: "Workspace verification failed on resume", resolved: true, status: "failed" },
      { status: 500 },
    );
  }

  // 7. Mark the run as "processing" (atomic — prevents duplicate executions)
  // The claim mints this executor's fencing token: renewals and terminal
  // writes below are conditioned on it, so a superseded or stale-marked
  // executor can never overwrite the truth this claim owns.
  const executionToken = randomUUID();
  const started = await markRunProcessing(pausedRunId, userId, executionToken);
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
  //
  // Lease + fence: the executor renews its lease every RUN_HEARTBEAT_MS,
  // carrying its last observed progress on the same write. If the renewal
  // reports the claim lost (stale/stall detector marked it, or a retry
  // claimed it), this executor is fenced — it aborts the loop at the next
  // step boundary and leaves the outcome to whoever owns the truth. A
  // thrown renewal is a transient DB error, not a fence: keep working.
  const abortController = new AbortController();
  let fenced = false;
  let lastProgressAt = new Date().toISOString();
  const heartbeat = setInterval(() => {
    void renewRunLease(pausedRunId, userId, executionToken, lastProgressAt)
      .then((alive) => {
        if (!alive) {
          fenced = true;
          abortController.abort();
        }
      })
      .catch(() => undefined);
  }, RUN_HEARTBEAT_MS);
  (heartbeat as NodeJS.Timeout).unref?.();
  // Zero-cost progress signal: every loop event refreshes the timestamp
  // the next heartbeat persists. A wedged loop stops producing events —
  // that is what separates "slow but working" from "alive but stalled".
  const runProgress = new ProgressEmitter(() => {
    lastProgressAt = new Date().toISOString();
  });

  const actionContext = resolved.actionRunId
    ? {
        actionRunId: resolved.actionRunId,
        userId,
        conversationId,
        projectId: resolved.projectId,
      }
    : undefined;

  if (actionContext) {
    try {
      await transitionActionRunEventActivity({
        runId: actionContext.actionRunId,
        userId,
        status: "working",
        eventType: "approval.approved",
        payload: { pausedRunId, toolId: resolved.toolId },
        message: `Approval granted for ${resolved.toolId}`,
        patch: {
          approvalReference: pausedRunId,
          currentActivity: `Approval granted for ${resolved.toolId}`,
        },
      });
    } catch (error) {
      const message = "Durable task state could not be updated for the approved run";
      studioLog("approval:action_run_resume_transition_failed", {
        conversationId,
        userId,
        pausedRunId,
        actionRunId: actionContext.actionRunId,
        errorClass: error instanceof Error ? error.message : "unknown",
      });
      clearInterval(heartbeat);
      await markRunFailed(pausedRunId, userId, message, executionToken);
      return NextResponse.json({ error: message, code: "ACTION_RUNTIME_UNAVAILABLE" }, { status: 503 });
    }
  }

  const resumeConfig: Partial<AgentLoopConfig> = {
    systemPrompt: resolved.systemPrompt,
    executionMode: resolved.executionMode,
    enableBuildFix: true,
    signal: abortController.signal,
    userId,
    // Conversation scope — injected into browser.start_session so the
    // resumed run reuses the live browser session from before the pause.
    conversationId,
    actionContext,
    // Quality loop: resume with a fresh evidence session so the resumed
    // run is gated the same way (agent markers re-harvest from history).
    // AUTO resumes opt in too — an AUTO run pauses for deploy approval,
    // and the resumed run must stay gated through DEPLOY/VERIFY.
    qualityLoop: shouldEnableQualityLoop(resolved.executionMode, resolved.projectId)
      ? {
          enabled: true,
          runId: `resume:${pausedRunId}:${randomUUID()}`,
          projectId: resolved.projectId,
          userId,
          userRequest: String(
            resolved.pausedMessages.find((m) => m.role === "user")?.content ?? "",
          ).slice(0, 2000),
          state: resolved.qualityLoopState,
        }
      : undefined,
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
      // Real pause-time counters — restarting these at 0 would hand the
      // resumed run a fresh budget/loop-detection state and let it repeat
      // work (or miss the "already mutated" signal) after approval.
      stepsUsedBeforePause: resolved.stepsUsed ?? 0,
      hadInterveningMutation: resolved.hadInterveningMutation ?? false,
      // The unexecuted remainder of the batch that hit the approval gate —
      // re-injected after the approved tool runs so approving one tool
      // cannot silently drop the rest of the batch.
      deferredToolCalls: resolved.deferredToolCalls,
      existingCheckpoint: resolved.checkpointId
        ? { checkpointId: resolved.checkpointId, label: "pre-approval", gitSha: "" }
        : undefined,
      // Capability set for the resume execution gate. Resolved fresh here
      // from the same source of truth the initial loop used
      // (resolveAvailableCapabilities), so the approved tool cannot fail
      // closed as "incapable" after the user approved it.
      availableCapabilities: resolveAvailableCapabilities({ transport }),
    },
    transport,
    runProgress,
  )
    .then(async (result) => {
      if (fenced) {
        // Another owner marked the truth (stale/stall detector, or a
        // superseding claim). Whatever this loop produced is not the
        // record — write nothing, let the recorded outcome stand.
        return;
      }
      // The loop produced a result — that is progress. Reset the stall
      // window for the settlement tail (preview verify, transcript write,
      // nested-gate persist); the heartbeat keeps the lease alive through it.
      lastProgressAt = new Date().toISOString();
      // Approval resume is a separate execution path from the initial
      // launch. Prove that an approved mutation really landed in the bound
      // workspace and restart/verify preview before marking the resumed run
      // complete. This closes the empty-project false-success gap where the
      // model's continuation text was persisted even though no runnable site
      // existed on disk.
      const successfulMutation = result.toolCalls.some((call) => call.mutating && call.success);
      const failedMutation = result.toolCalls.some((call) => call.mutating && !call.success);
      let resumeFailure: string | undefined;
      let resumePreview: Awaited<ReturnType<typeof ensureProjectPreviewReady>> | null = null;
      if (!result.pendingApproval && !result.cancelled) {
        if (result.modelFailed) {
          // The resumed loop stopped because the model itself failed
          // (provider routes exhausted, budget spent, upstream error).
          // Surface that real reason — letting the artifact gate run here
          // would mask it behind a misleading "no runnable entry file"
          // error even though the approved mutation may have succeeded.
          resumeFailure =
            result.modelFailureText ??
            `The resumed run could not complete: ${result.modelFailed}`;
        } else if (failedMutation && !successfulMutation) {
          resumeFailure = "The approved workspace operation failed, so the project was not completed.";
        } else if (successfulMutation) {
          resumePreview = await ensureProjectPreviewReady(transport, {}, undefined, actionContext);
          if (!resumePreview.ok) {
            resumeFailure = resumePreview.error ?? "The project files were not runnable after approval.";
          }
        }
      } else if (result.pendingApproval && successfulMutation) {
        // A nested approval is allowed to continue, but preview can already
        // be useful once the first file mutation has landed. Do not fail the
        // nested gate merely because a later file has not been written yet.
        resumePreview = await ensureProjectPreviewReady(transport, {}, undefined, actionContext).catch(() => null);
      }

      if (resumeFailure) {
        await writeResumedResultToTranscript({
          conversationId,
          userId,
          projectId: resolved.projectId,
          pausedRunId,
          status: "failed",
          content: resumeFailure,
        });
        await markRunFailed(pausedRunId, userId, resumeFailure, executionToken);
        await settleParentActionRun(
          resolved,
          "failed",
          { currentActivity: "Task failed", failureCode: "TASK_FAILED", failureMessage: resumeFailure },
          "approval:action_run_failure_settle_failed",
        );
        return;
      }

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
            actionRunId: actionContext?.actionRunId ?? null,
            qualityLoopState: result.pendingApproval.qualityLoopState,
            deferredToolCalls: result.pendingApproval.deferredToolCalls,
            stepsUsed: result.pendingApproval.stepsUsedAtPause,
            hadInterveningMutation: result.pendingApproval.hadInterveningMutationAtPause,
          });
          nestedPausedRunId = nested.id;
          if (actionContext) {
            await transitionActionRunEventActivity({
              runId: actionContext.actionRunId,
              userId,
              status: "waiting_for_user",
              eventType: "approval.required",
              payload: {
                toolId: result.pendingApproval.toolId,
                pausedRunId: nestedPausedRunId,
              },
              message: `Approval required for ${result.pendingApproval.toolId}`,
              patch: {
                approvalReference: nestedPausedRunId,
                currentActivity: `Approval required for ${result.pendingApproval.toolId}`,
              },
            });
          }
        } catch (nestedErr) {
          studioLog("approval:nested_paused_run_persist_failed", {
            conversationId,
            userId,
            tool: result.pendingApproval.toolId,
            errorClass: nestedErr instanceof Error ? nestedErr.message : "unknown",
          });
          // A nested gate that cannot be persisted is unresumable — the
          // client's Approve button would be a dead card (pausedRunId:
          // undefined). Fail the run loudly instead of completing it with
          // a broken gate.
          const nestedPersistError =
            `The follow-up approval for \`${result.pendingApproval.toolId}\` could not be saved — send the request again to retry.`;
          await writeResumedResultToTranscript({
            conversationId,
            userId,
            projectId: resolved.projectId,
            pausedRunId,
            status: "failed",
            content: nestedPersistError,
          });
          await markRunFailed(pausedRunId, userId, nestedPersistError, executionToken);
          await settleParentActionRun(
            resolved,
            "failed",
            { currentActivity: nestedPersistError, failureCode: "APPROVAL_STATE_UNAVAILABLE", failureMessage: nestedPersistError },
            "approval:action_run_nested_settle_failed",
          );
          return;
        }
      }

      let qualityLoop = result.qualityLoop;
      let qualityLoopState = result.qualityLoopState;
      let finalText = result.finalText;

      // Preview startup is owned by the approval boundary, not by the agent
      // loop. Feed its real artifact/runtime result back into the same
      // canonical ledger before persisting the terminal run result. This is
      // what prevents a successful resumed run from reporting all stages as
      // pending merely because those events happened outside the LLM loop.
      if (qualityLoopState && successfulMutation) {
        const qualitySession = restoreQualityLoopSession(qualityLoopState);
        const previewUrl = buildPreviewProxyUrl(transport.workspaceId);
        if (resumePreview?.ok) {
          noteBuildArtifacts(qualitySession, resumePreview.files);
          notePreviewReady(qualitySession, previewUrl);
          const finale = finalizeQualityLoop(qualitySession, {
            deployRequested:
              resolved.toolId === "project.deploy" ||
              result.toolCalls.some((call) => call.toolId === "project.deploy"),
          });
          qualityLoop = {
            verdict: finale.verdict,
            stages: finale.stages,
            designPasses: finale.designPasses,
          };
          qualityLoopState = snapshotQualityLoopSession(qualitySession);
          if (finale.verdict.ok) {
            // The resumed agent may have finalized before the approval-boundary
            // preview check completed. Remove only that stale machine-gate
            // suffix; never suppress ordinary model output or a failed gate.
            finalText = finalText.replace(/\n\nQuality check — [\s\S]*$/i, "");
          }
        }
      }

      // Reflect the final outcome on the transcript BEFORE marking the run
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
        content: finalText || undefined,
      });

      const runResult: RunResult = {
        finalText,
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
        // Persist the quality-loop finale on the run record: the durable,
        // machine-readable answer to "was this good enough to ship?"
        qualityLoop: qualityLoop
          ? {
              verdict: qualityLoop.verdict,
              stages: qualityLoop.stages,
              designPasses: qualityLoop.designPasses,
            }
          : undefined,
        qualityLoopState,
      };
      const completion = await markRunCompleted(pausedRunId, userId, runResult, executionToken);
      if (!result.pendingApproval) {
        await settleParentActionRun(
          resolved,
          result.cancelled ? "cancelled" : "completed",
          {
            currentActivity: result.cancelled ? "Task cancelled by user" : "Task completed",
            approvalReference: null,
            failureCode: null,
            failureMessage: null,
          },
          result.cancelled
            ? "approval:action_run_cancel_settle_failed"
            : "approval:action_run_complete_settle_failed",
        );
      }
      return completion;
    })
    .catch(async (err) => {
      if (fenced) return;
      const message = err instanceof Error ? err.message : "Resume failed";
      await writeResumedResultToTranscript({
        conversationId,
        userId,
        projectId: resolved.projectId,
        pausedRunId,
        status: "failed",
        content: `The resumed run failed: ${message}`,
      });
      await settleParentActionRun(
        resolved,
        "failed",
        { currentActivity: "Task failed", failureCode: "TASK_FAILED", failureMessage: message },
        "approval:action_run_exception_settle_failed",
      );
      return markRunFailed(pausedRunId, userId, message, executionToken);
    })
    .finally(() => {
      // The executor's work — loop and settlement tail — is done either
      // way; stop proving liveness. A fenced executor dies here too.
      clearInterval(heartbeat);
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
