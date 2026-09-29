import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import {
  getPausedRun,
  resolvePausedRun,
  resetRunForRetry,
  markRunProcessing,
  verifyRunClaim,
  releaseRunClaim,
  updatePausedRunActionRun,
  getRunOutcomeForPausedRun,
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
  stripQualityVerdictSuffix,
} from "@/lib/litt-intelligence/quality-loop-flow";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { getCheckpoint } from "@/lib/missions/mission-repository";
import {
  getAwaitingApprovalAssistantMessage,
  insertMessage,
  updateMessageStatus,
} from "@/lib/studio/conversation-service";
import { studioLog } from "@/lib/studio/logger";
import {
  createActionRun,
  getActionRun,
  appendActionEvent,
  transitionActionRunEventActivity,
  type ActionRunPatch,
  type ActionRunStatus,
} from "@/lib/action-runtime";
import { isTerminalActionRunStatus } from "@/lib/action-runtime/state-machine";
import type { MessageStatus } from "@/lib/studio/types";

/**
 * Write a resumed run's outcome back onto the conversation transcript.
 * The assistant message that paused stays "awaiting_approval" until the
 * resumed execution finishes — without this writeback a page refresh would
 * show a run that never resolved. If the original message can't be found
 * (deleted conversation etc.), the result is appended as a new message so
 * the work isn't invisible. Best-effort: the authoritative outcome is
 * already durable on the canonical action_run.
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
 * Record a resumed run's outcome on the canonical action_run — THE
 * authority for execution state (action_runs + ordered action_events).
 *
 * One fenced executor → one atomic RPC
 * (action_runtime_transition_event_activity: row lock + terminal guard +
 * transition validation + status update + event insert + optional activity
 * insert) → one terminal status + one outcome event carrying the RunResult
 * payload. The RunResult rides the event payload, so no new event type and
 * no migration are needed.
 *
 * Errors PROPAGATE to the caller. The previous settle helper swallowed
 * them, which is exactly how a run could end up "failed" on the gate while
 * the run ledger stayed non-terminal — the stall that motivated this work.
 *
 * When an execution token is presented, the claim is verified first: a
 * superseded or reaped executor must not write the outcome. After the
 * authoritative write lands, the claim is released as bookkeeping — the
 * paused run's run_status is claim lifecycle, never execution truth
 * (consumers read through getRunOutcomeForPausedRun).
 *
 * Returns true when the outcome was recorded, or when it was already
 * recorded (ACTION_RUN_TERMINAL_IMMUTABLE means a racing settler — reaper
 * or earlier attempt — won, which is the honest outcome). Throws when the
 * authoritative write genuinely fails.
 */
async function settleResumedRunOutcome(opts: {
  record: PausedRunRecord;
  userId: string;
  status: ActionRunStatus;
  eventType:
    | "run.completed"
    | "run.failed"
    | "run.cancelled"
    | "approval.required"
    | "approval.rejected";
  patch: ActionRunPatch;
  /** Terminal outcome payload — carried on the outcome event. */
  runResult?: RunResult;
  /** Fenced executor claim. Omit for pre-claim failures. */
  executionToken?: string;
  logEvent: string;
}): Promise<boolean> {
  const {
    record, userId, status, eventType, patch, runResult, executionToken, logEvent,
  } = opts;
  if (!record.actionRunId) {
    throw new Error("settleResumedRunOutcome: no parent action_run");
  }
  const ids = {
    conversationId: record.conversationId,
    userId,
    pausedRunId: record.id,
    actionRunId: record.actionRunId,
    status,
    eventType,
  };
  if (executionToken) {
    const owns = await verifyRunClaim(record.id, userId, executionToken);
    if (!owns) {
      // Another owner settled this run (stale/stall reaper, or a
      // superseding claim). Whatever this executor produced is not the
      // record of truth — do not write.
      studioLog(logEvent, { ...ids, claimLost: true });
      return false;
    }
  }
  const written = await transitionActionRunEventActivity({
    runId: record.actionRunId,
    userId,
    status,
    eventType,
    payload: {
      pausedRunId: record.id,
      toolId: record.toolId,
      ...(runResult ? { result: runResult } : {}),
    },
    message: patch.currentActivity ?? `Run ${status}`,
    patch,
  }).catch((error) => {
    const msg = error instanceof Error ? error.message : "";
    if (/ACTION_RUN_TERMINAL_IMMUTABLE/.test(msg)) {
      // A racing settler already recorded the terminal truth. That IS the
      // outcome — not a failure.
      studioLog(logEvent, { ...ids, alreadyTerminal: true });
      return null;
    }
    studioLog(logEvent, {
      ...ids,
      errorClass: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  });
  if (executionToken && written) {
    // Claim release is bookkeeping: the outcome is durable on the
    // action_run as of the write above. A lost race here just means the
    // reaper already retired the claim.
    await releaseRunClaim(
      record.id,
      userId,
      executionToken,
      status === "failed" ? "failed" : "completed",
    );
  }
  return true;
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

  // The gate belongs to the conversation it was paused in. Check this
  // BEFORE any idempotent/early-return path below — a resolved gate must
  // not leak its status under a different conversation URL.
  if (pausedRun.conversationId !== conversationId) {
    return NextResponse.json({ error: "Conversation mismatch" }, { status: 403 });
  }

  // The approval is subordinate to its durable parent task. If Stop already
  // settled that task, this gate is historical evidence — not a button that
  // can resurrect a cancelled run. The one exception is the controlled
  // retry: a FAILED parent is exactly what a retry is for (it mints a fresh
  // run below), while a cancelled parent stays historical — Stop's decision
  // is final.
  if (pausedRun.actionRunId) {
    const parentRun = await getActionRun(pausedRun.actionRunId, userId);
    if (!parentRun) {
      return NextResponse.json(
        { error: "The parent task for this approval is no longer available", code: "ACTION_RUN_NOT_FOUND" },
        { status: 409 },
      );
    }
    const isFailedRetry =
      body.decision === "approved" &&
      pausedRun.status === "approved" &&
      parentRun.status === "failed";
    if (isTerminalActionRunStatus(parentRun.status) && !isFailedRetry) {
      return NextResponse.json(
        {
          error: `The parent task is already ${parentRun.status}`,
          code: "ACTION_RUN_TERMINAL",
          status: parentRun.status,
        },
        { status: 409 },
      );
    }
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
    // Retry eligibility is read from the DERIVED outcome (the canonical
    // action_run), not the claim field: a retry is a new execution attempt
    // and it is allowed exactly when the last attempt's outcome is failed.
    const outcome = await getRunOutcomeForPausedRun(pausedRun, userId);
    if (
      body.decision === "approved" &&
      pausedRun.status === "approved" &&
      outcome.runStatus === "failed"
    ) {
      const retried = await resetRunForRetry(pausedRunId, userId);
      if (retried) {
        retriedApproval = pausedRun;
      } else {
        // Lost a race with another retry request — report current state.
        const current = await getPausedRun(pausedRunId, userId);
        const currentOutcome = current
          ? await getRunOutcomeForPausedRun(current, userId)
          : null;
        return NextResponse.json({
          resolved: true,
          decision: "approved",
          status: currentOutcome?.runStatus ?? "processing",
          pausedRunId,
          runStatus: currentOutcome?.runStatus,
          runError: currentOutcome?.runError,
        }, { status: 202 });
      }
    } else if (pausedRun.status === "approved" || pausedRun.status === "rejected") {
      return NextResponse.json({
        resolved: true,
        decision: pausedRun.status,
        status: outcome.runStatus ?? "processing",
        pausedRunId,
        runStatus: outcome.runStatus,
        runError: outcome.runError,
      }, { status: 202 });
    } else {
      return NextResponse.json(
        { error: `Approval already ${pausedRun.status}` },
        { status: 409 },
      );
    }
  }

  // 2. Resolve the approval (single-use, atomic). A controlled retry
  // reuses the existing record — the approval was already granted.
  let resolved =
    retriedApproval ?? (await resolvePausedRun(pausedRunId, userId, body.decision));
  if (!resolved) {
    return NextResponse.json(
      { error: "Approval could not be resolved (expired or already resolved)" },
      { status: 409 },
    );
  }

  // 3. For REJECTED: no resumed execution needed — return immediately.
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
    await settleResumedRunOutcome({
      record: resolved,
      userId,
      status: "cancelled",
      eventType: "approval.rejected",
      patch: {
        currentActivity: "Approval declined — task cancelled",
        approvalReference: null,
      },
      logEvent: "approval:action_run_reject_settle_failed",
    });
    return NextResponse.json({
      resolved: true,
      decision: "rejected",
      status: "completed",
      pausedRunId,
    });
  }

  // 4. For APPROVED: validate workspace, then start detached execution.
  // The approved operation's identity rides the transport so tools with
  // idempotent side effects (image.generate billing) derive a stable
  // operation key from it — a retried approval replays, never double-debits.
  let transport;
  try {
    transport = await createWorkspaceTransport(resolved.projectId, userId, {
      operationId: pausedRunId,
    });
  } catch {
    // Pre-claim failure: no executor owns this run yet. Record the outcome
    // directly on the canonical action_run — there is no claim to release.
    await settleResumedRunOutcome({
      record: resolved,
      userId,
      status: "failed",
      eventType: "run.failed",
      patch: { currentActivity: "Workspace is no longer available", failureCode: "WORKSPACE_UNAVAILABLE", failureMessage: "Workspace is no longer available" },
      logEvent: "approval:action_run_workspace_settle_failed",
    });
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

  // 5. Verify workspace hasn't changed in a way that invalidates the approval
  try {
    const verified = await verifyProjectWorkspace(resolved.projectId, userId);
    if (verified.workspaceId !== resolved.workspaceId) {
      await settleResumedRunOutcome({
        record: resolved,
        userId,
        status: "failed",
        eventType: "run.failed",
        patch: { currentActivity: "Workspace changed since approval", failureCode: "WORKSPACE_CHANGED", failureMessage: "Workspace changed since approval" },
        logEvent: "approval:action_run_workspace_change_settle_failed",
      });
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
    await settleResumedRunOutcome({
      record: resolved,
      userId,
      status: "failed",
      eventType: "run.failed",
      patch: { currentActivity: "Workspace verification failed on resume", failureCode: "WORKSPACE_VERIFICATION_FAILED", failureMessage: "Workspace verification failed on resume" },
      logEvent: "approval:action_run_workspace_verify_settle_failed",
    });
    return NextResponse.json(
      { error: "Workspace verification failed on resume", resolved: true, status: "failed" },
      { status: 500 },
    );
  }

  // 6. Mark the run as "processing" (atomic — prevents duplicate executions)
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

  // Controlled retry, continued: the previous attempt's action_run is
  // terminal, and a terminal run cannot run again
  // (ACTION_RUN_TERMINAL_IMMUTABLE — this used to be a hard 503). Mint a
  // FRESH canonical run for this attempt and repoint the gate at it: one
  // run = one execution attempt, and the failed attempt stays as honest
  // history. This runs after the claim so a crash before the claim leaves
  // no orphan; a crash after the claim is reaped by the stale-run
  // detector, which settles whatever action_run_id the gate points at.
  if (retriedApproval) {
    // INV-010 lineage: the causal link (failed attempt -> retry attempt) is
    // recorded as a durable event on the new run — no schema change, no new
    // run model; the ordered action_events log is the lineage record. Null
    // for legacy rows that never had a canonical run: there is no causal
    // predecessor in the ledger to point at.
    const previousActionRunId = resolved.actionRunId ?? null;
    try {
      const retryRun = await createActionRun({
        userId,
        projectId: resolved.projectId,
        conversationId,
        kind: "agent",
        currentActivity: `Retrying approved ${resolved.toolId}`,
      });
      if (previousActionRunId) {
        await appendActionEvent({
          runId: retryRun.id,
          userId,
          type: "run.retry_of",
          payload: { causation_action_run_id: previousActionRunId },
        });
      }
      const repointed = await updatePausedRunActionRun(pausedRunId, userId, retryRun.id);
      if (!repointed) throw new Error("repoint failed");
      resolved = { ...resolved, actionRunId: retryRun.id };
    } catch (error) {
      studioLog("approval:retry_action_run_mint_failed", {
        conversationId,
        userId,
        pausedRunId,
        errorClass: error instanceof Error ? error.message : "unknown",
      });
      // The attempt never started: release the claim as failed so the gate
      // stays retry-eligible. The stale-run detector will settle the
      // orphaned fresh run when its (never-renewed) claim lapses.
      await releaseRunClaim(pausedRunId, userId, executionToken, "failed").catch(
        () => undefined,
      );
      return NextResponse.json(
        { error: "Retry could not start", code: "ACTION_RUNTIME_UNAVAILABLE" },
        { status: 503 },
      );
    }
  }

  // 7. Start the resumed execution DETACHED from this HTTP request.
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
      // The attempt never started: settle the canonical run as failed
      // best-effort so the ledger never sits non-terminal, then release
      // the claim so the gate stays retry-eligible.
      try {
        await settleResumedRunOutcome({
          record: resolved,
          userId,
          status: "failed",
          eventType: "run.failed",
          patch: { currentActivity: message, failureCode: "ACTION_RUNTIME_UNAVAILABLE", failureMessage: message },
          executionToken,
          logEvent: "approval:action_run_resume_transition_settle_failed",
        });
      } catch {
        await releaseRunClaim(pausedRunId, userId, executionToken, "failed").catch(
          () => undefined,
        );
      }
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

  // The paused-run record persists only the checkpointId — recover the real
  // pre-mutation git SHA from the checkpoint row (the durable source of
  // truth) and thread it into the resume. Without it, computeWorkspaceChange
  // short-circuits on the empty SHA and always reports "unknown", which
  // defeated the workspace-change scoping of the artifact gate on every
  // approval-resume (#551): the resumed run could never prove it changed
  // files. A missing checkpoint row (legacy rows) keeps the previous
  // empty-SHA behavior.
  let resumeCheckpoint: { checkpointId: string; label: string; gitSha: string } | undefined;
  if (resolved.checkpointId) {
    const checkpointRow = await getCheckpoint(resolved.checkpointId, userId).catch(() => null);
    resumeCheckpoint = {
      checkpointId: resolved.checkpointId,
      label: "pre-approval",
      gitSha: checkpointRow?.gitSha ?? "",
    };
  }

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
      existingCheckpoint: resumeCheckpoint,
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
          // Scope the artifact gate with the resumed run's own workspace
          // evidence: a "changed" diff proves the approved mutation landed,
          // so the welcome-screen marker check (which only detects stalled
          // *launches*) must not fail the run with "no real project files
          // were created". The run's own successful-mutation record is
          // passed as defense in depth for when the diff could not run
          // ("unknown") — it is NOT enough on its own: an affirmative
          // "unchanged" diff keeps the strict gate so a tool that lied
          // (or wrote to the wrong workspace) still fails honestly.
          resumePreview = await ensureProjectPreviewReady(
            transport,
            { workspaceChange: result.workspaceChange ?? null, hadSuccessfulMutation: successfulMutation },
            undefined,
            actionContext,
          );
          if (!resumePreview.ok) {
            resumeFailure = resumePreview.error ?? "The project files were not runnable after approval.";
          }
        }
      } else if (result.pendingApproval && successfulMutation) {
        // A nested approval is allowed to continue, but preview can already
        // be useful once the first file mutation has landed. Do not fail the
        // nested gate merely because a later file has not been written yet.
        resumePreview = await ensureProjectPreviewReady(
          transport,
          { hadSuccessfulMutation: successfulMutation },
          undefined,
          actionContext,
        ).catch(() => null);
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
        // Canonical settle FIRST — the outcome is recorded on the action_run
        // (errors propagate; a silent divergence is worse than a loud
        // failure). The claim is verified and released inside.
        await settleResumedRunOutcome({
          record: resolved,
          userId,
          status: "failed",
          eventType: "run.failed",
          patch: { currentActivity: "Task failed", failureCode: "TASK_FAILED", failureMessage: resumeFailure },
          executionToken,
          logEvent: "approval:action_run_failure_settle_failed",
        });
        return;
      }

      // The resumed run can hit a NEW approval gate. That handoff is
      // recorded below, AFTER the runResult is built, so the outer
      // attempt's outcome and the waiting_for_user transition land in ONE
      // atomic RPC (settleResumedRunOutcome) — never two writers.

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
            finalText = stripQualityVerdictSuffix(finalText);
          }
        }
      }

      // Reflect the final outcome on the transcript BEFORE marking the run
      // completed — a poller that sees "completed" can then loadMessages
      // and get the real persisted result. An honest loop failure is
      // reported as failed, never completed.
      await writeResumedResultToTranscript({
        conversationId,
        userId,
        projectId: resolved.projectId,
        pausedRunId,
        status: result.cancelled
          ? "cancelled"
          : result.pendingApproval
            ? "awaiting_approval"
            : result.failedHonestly
              ? "failed"
              : "completed",
        content: (result.failedHonestly || finalText) || undefined,
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
              pausedRunId: undefined,
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

      // Nested-gate handoff: persist the new gate, then record the outer
      // attempt's outcome and the waiting_for_user transition in ONE atomic
      // RPC. The derived outcome (getRunOutcomeForPausedRun) reads the
      // approval.required event's payload.result and reports this gate as
      // completed with the nested gate's pausedRunId.
      if (result.pendingApproval) {
        let nestedPausedRunId: string;
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
            actionRunId: resolved.actionRunId ?? null,
            qualityLoopState: result.pendingApproval.qualityLoopState,
            deferredToolCalls: result.pendingApproval.deferredToolCalls,
            stepsUsed: result.pendingApproval.stepsUsedAtPause,
            hadInterveningMutation: result.pendingApproval.hadInterveningMutationAtPause,
          });
          nestedPausedRunId = nested.id;
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
          await settleResumedRunOutcome({
            record: resolved,
            userId,
            status: "failed",
            eventType: "run.failed",
            patch: { currentActivity: nestedPersistError, failureCode: "APPROVAL_STATE_UNAVAILABLE", failureMessage: nestedPersistError },
            executionToken,
            logEvent: "approval:action_run_nested_settle_failed",
          });
          return;
        }
        runResult.pendingApproval = {
          toolId: result.pendingApproval.toolId,
          pausedRunId: nestedPausedRunId,
          reason: result.pendingApproval.reason,
        };
        await settleResumedRunOutcome({
          record: resolved,
          userId,
          status: "waiting_for_user",
          eventType: "approval.required",
          patch: {
            approvalReference: nestedPausedRunId,
            currentActivity: `Approval required for ${result.pendingApproval.toolId}`,
          },
          runResult,
          executionToken,
          logEvent: "approval:action_run_nested_handoff_settle_failed",
        });
        return true;
      }

      // Terminal outcome: one atomic write of status + outcome event
      // carrying the RunResult. An honest loop failure is reported as
      // failed, never completed.
      const honestFailure = result.failedHonestly;
      await settleResumedRunOutcome({
        record: resolved,
        userId,
        status: result.cancelled ? "cancelled" : honestFailure ? "failed" : "completed",
        eventType: result.cancelled ? "run.cancelled" : honestFailure ? "run.failed" : "run.completed",
        patch: {
          currentActivity: result.cancelled
            ? "Task cancelled by user"
            : honestFailure
              ? "Task failed"
              : "Task completed",
          approvalReference: null,
          failureCode: honestFailure ? "TASK_FAILED" : null,
          failureMessage: honestFailure ? honestFailure.slice(0, 500) : null,
        },
        runResult,
        executionToken,
        logEvent: result.cancelled
          ? "approval:action_run_cancel_settle_failed"
          : "approval:action_run_complete_settle_failed",
      });
      return true;
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
      // Last-resort settle. Best-effort because we are already handling a
      // failure: if the canonical write fails too, the claim is released
      // so the gate stays retry-eligible, and the stale-run detector
      // settles the ledger when the lease lapses.
      try {
        await settleResumedRunOutcome({
          record: resolved,
          userId,
          status: "failed",
          eventType: "run.failed",
          patch: { currentActivity: "Task failed", failureCode: "TASK_FAILED", failureMessage: message },
          executionToken,
          logEvent: "approval:action_run_exception_settle_failed",
        });
      } catch {
        await releaseRunClaim(pausedRunId, userId, executionToken, "failed").catch(
          () => undefined,
        );
      }
    })
    .finally(() => {
      // The executor's work — loop and settlement tail — is done either
      // way; stop proving liveness. A fenced executor dies here too.
      clearInterval(heartbeat);
    });

  // 8. Return 202 Accepted immediately — the execution continues in the background
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

  const { conversationId, pausedRunId } = await params;
  const pausedRun = await getPausedRun(pausedRunId, userId);
  if (!pausedRun) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (pausedRun.conversationId !== conversationId) {
    return NextResponse.json({ error: "Conversation mismatch" }, { status: 403 });
  }

  // Execution outcome is derived from the canonical action_run — the
  // paused run's own run_* fields are claim bookkeeping, never the truth.
  const outcome = await getRunOutcomeForPausedRun(pausedRun, userId);

  return NextResponse.json({
    id: pausedRun.id,
    toolId: pausedRun.toolId,
    inputs: pausedRun.inputs,
    reason: pausedRun.reason,
    status: pausedRun.status,
    expiresAt: pausedRun.expiresAt,
    createdAt: pausedRun.createdAt,
    runStatus: outcome.runStatus,
    runResult: outcome.runResult,
    runError: outcome.runError,
    runStartedAt: outcome.runStartedAt,
    runCompletedAt: outcome.runCompletedAt,
  });
}
