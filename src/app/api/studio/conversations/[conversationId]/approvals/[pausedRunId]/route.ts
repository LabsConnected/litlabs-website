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
  listPausedRunsForActionRun,
  createPausedRun,
  renewRunLease,
  RUN_HEARTBEAT_MS,
  RUN_STALL_MS,
  type PausedRunRecord,
  type RunResult,
} from "@/lib/litt-intelligence/paused-run-store";
import { isUserCancelReason } from "@/lib/studio/cancel-attribution";
import { ProgressEmitter } from "@/lib/litt-intelligence/progress-events";
import {
  createWorkspaceTransport,
  type CheckpointInfo,
} from "@/lib/litt-intelligence/workspace-transport";
import {
  decodeManifestCheckpointDescription,
  MANIFEST_CHECKPOINT_DESCRIPTION_PREFIX,
} from "@/lib/missions/workspace-manifest";
import { resumeAgentLoopV2, isFileWritingTool, type AgentLoopConfig } from "@/lib/litt-intelligence/agent-loop-v2";
import {
  computeWorkspaceChange,
  computeWorkspaceRevision,
  type WorkspaceChangeProbe,
} from "@/lib/litt-intelligence/workspace-change-producer";
import {
  evaluatePublishGate,
  isDeployToolId,
  selectVerifiedRevision,
  sessionHasVerificationEvidence,
  type PublishGateDecision,
  type SettledRunVerification,
} from "@/lib/studio/verified-revision";
import type { WorkspaceChangeEvidence } from "@/lib/studio/completion-evidence";
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
import { getProject, verifyProjectWorkspace } from "@/lib/projects/project-repository";
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
  listActionEvents,
  listActionRuns,
  transitionActionRunEventActivity,
  type ActionRunPatch,
  type ActionRunStatus,
} from "@/lib/action-runtime";
// Item 5a — deep import on purpose: the barrel is mocked in route tests,
// and the persistence hook must stay the real one.
import { makePersistProgressEvent } from "@/lib/action-runtime/progress-event-persistence";
import { isTerminalActionRunStatus } from "@/lib/action-runtime/state-machine";
import type { MessageStatus } from "@/lib/studio/types";
import { attachActionRunToConversationTask, settleConversationTask } from "@/lib/studio/task-service";
import {
  getActiveExecution,
  registerExecution,
  unregisterExecution,
} from "@/lib/studio/execution-registry";
import { reserveCredits, settleRun, estimateCredits, computeResumeQuoteBits, resumeQuoteDisclosure } from "@/lib/agent-billing";

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
  if (written) {
    // Audit (R3 / E2-Q5): the happy-path settle used to be stdout-silent —
    // an approval's outcome was auditable only in the DB. Ids + outcome.
    studioLog("approval:run_settled", { ...ids });
    await settleConversationTask(
      userId, record.conversationId,
      status === "waiting_for_user" ? "waiting_approval" : status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed",
      status === "completed" &&
        (runResult?.qualityLoop?.verdict.ok === true ||
          // A publish settle the verified-revision gate allowed IS a
          // verified completion (R5-B): the published bytes are the
          // verified bytes, proven by the gate's own audit record.
          runResult?.publishGate?.allowed === true),
      record.actionRunId,
    ).catch((error) => studioLog("approval:task_settle_failed", {
      ...ids, errorClass: error instanceof Error ? error.message : "unknown",
    }));
  }
  return true;
}

/**
 * Recover the real pre-mutation baseline for a paused run from its
 * checkpoint row (the durable source of truth). The paused-run record
 * persists only the checkpointId; without this recovery,
 * computeWorkspaceChange short-circuits on the empty SHA and always
 * reports "unknown", which defeated the workspace-change scoping of the
 * artifact gate on every approval-resume (#551).
 *
 * Manifest checkpoints (Gate 1): when git was unavailable at checkpoint
 * time, the row's git_sha is empty and the path → sha256 baseline rides
 * the row's description under the manifest prefix. Decode and thread
 * the whole CheckpointInfo — dropping kind/manifest here would strand
 * the finale with the same automatic "unknown". A row that carries the
 * prefix but does not decode is threaded as kind: "manifest" with NO
 * manifest: the producer fails closed with "unknown" for it, never a
 * changed/unchanged verdict and never a silent downgrade to a git
 * baseline. A real git SHA always wins the git path. A missing row
 * (legacy) keeps the previous empty-SHA behavior, which the producer
 * also answers "unknown".
 */
async function recoverCheckpointInfo(
  checkpointId: string | null,
  userId: string,
): Promise<CheckpointInfo | undefined> {
  if (!checkpointId) return undefined;
  const checkpointRow = await getCheckpoint(checkpointId, userId).catch(() => null);
  const description = checkpointRow?.description ?? null;
  if (
    !checkpointRow?.gitSha &&
    description?.startsWith(MANIFEST_CHECKPOINT_DESCRIPTION_PREFIX)
  ) {
    const manifest = decodeManifestCheckpointDescription(description);
    return {
      checkpointId,
      label: "pre-approval",
      gitSha: "",
      kind: "manifest",
      ...(manifest ? { manifest } : {}),
    };
  }
  return {
    checkpointId,
    label: "pre-approval",
    gitSha: checkpointRow?.gitSha ?? "",
  };
}

/**
 * The project's canonical verified-revision record (Repair R5-B): scan
 * the project's recent settled runs (newest first, EXCLUDING the run
 * being resumed) and select the newest whose terminal outcome event
 * carries an ok quality verdict bound to a recorded workspace revision.
 * This is the durable record the publish gate reads — never a run's
 * cached status and never the publish run's own empty session. Any read
 * failure yields null (no record), and the gate fails closed on null.
 */
function normalizeWorkspacePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/^\//, "");
}

/** The approved target file of a gated call, when its frozen inputs name one. */
function approvedTargetPath(inputs: Record<string, unknown> | null | undefined): string | null {
  if (!inputs) return null;
  for (const key of ["path", "filePath", "file", "targetPath"]) {
    const value = inputs[key];
    if (typeof value === "string" && value.trim()) return normalizeWorkspacePath(value);
  }
  return null;
}

/**
 * Whether the resumed segment proves the APPROVED file edit landed
 * (Repair R5-C, strengthened in verification): the approved tool
 * itself ran successfully; the run's workspace verdict does not prove
 * nothing changed (a no-op write "succeeding" is not an edit); and —
 * when the verdict enumerates the changed files and the approved
 * target is known — the target is among them. "Some mutation happened
 * somewhere in the segment" is not proof: the approved call can be
 * dropped while a deferred call succeeds, and a successful write to
 * the WRONG file leaves the approved change unapplied.
 */
function approvedEditLanded(
  result: {
    toolCalls: Array<{ toolId: string; success: boolean }>;
    workspaceChange?: WorkspaceChangeEvidence | null;
  },
  resolved: { toolId: string; inputs?: Record<string, unknown> | null },
): boolean {
  if (!result.toolCalls.some((call) => call.toolId === resolved.toolId && call.success)) {
    return false;
  }
  const change = result.workspaceChange;
  if (change?.status === "unchanged") return false;
  if (change?.status === "changed" && Array.isArray(change.files) && change.files.length > 0) {
    const target = approvedTargetPath(resolved.inputs);
    if (target) return change.files.some((file) => normalizeWorkspacePath(file) === target);
  }
  return true;
}

async function loadProjectVerifiedRevision(opts: {
  userId: string;
  projectId: string;
  excludeRunId: string | null;
}): Promise<{ revision: string; runId: string } | null> {
  try {
    const runs = await listActionRuns(opts.userId, {
      projectId: opts.projectId,
      limit: 10,
    });
    const settled: SettledRunVerification[] = [];
    for (const run of runs) {
      if (opts.excludeRunId && run.id === opts.excludeRunId) continue;
      if (
        run.status !== "completed" &&
        run.status !== "failed" &&
        run.status !== "cancelled"
      ) {
        continue;
      }
      const events = await listActionEvents(run.id, opts.userId);
      let outcome: { verdictOk: boolean; verifiedRevision: string | null } | null = null;
      for (const event of events) {
        if (
          event.type !== "run.completed" &&
          event.type !== "run.failed" &&
          event.type !== "run.cancelled"
        ) {
          continue;
        }
        const result = (
          event.payload as {
            result?: {
              qualityLoop?: { verdict?: { ok?: boolean } };
              verifiedRevision?: string | null;
            };
          } | null
        )?.result;
        outcome = {
          verdictOk: result?.qualityLoop?.verdict?.ok === true,
          verifiedRevision:
            typeof result?.verifiedRevision === "string" ? result.verifiedRevision : null,
        };
      }
      if (outcome) {
        settled.push({ runId: run.id, ...outcome });
      }
    }
    return selectVerifiedRevision(settled);
  } catch {
    return null;
  }
}

/**
 * Settle-time workspace verdict (R3 / E4-R4).
 *
 * A run that settles WITHOUT reaching a loop finalize tail — rejected
 * at a gate, an executor that threw, a watchdog settle — never computes
 * a verdict in the loop, but its lineage may already have mutated
 * files. Compute the verdict HERE, from the run's stored checkpoint +
 * a workspace transport, so the settled record states what happened
 * to the files: changed/unchanged as the evidence says, or "unknown"
 * when the comparison cannot be made. Fail-closed throughout: a
 * transport that cannot be created or a comparison that throws yields
 * an explicit "unknown" evidence object, never an absence dressed as
 * "unchanged" — and never a thrown error into the settle path.
 *
 * Returns null only when the run has no checkpoint at all: with no
 * baseline there is nothing to diff, and absence is the codebase's
 * honest state for a run that never reached a mutation.
 */
async function computeSettleWorkspaceChange(opts: {
  record: PausedRunRecord;
  userId: string;
  /** The settle site's own transport, when it already has one. */
  probe?: WorkspaceChangeProbe;
}): Promise<WorkspaceChangeEvidence | null> {
  const { record, userId } = opts;
  if (!record.checkpointId) return null;
  let checkpoint: CheckpointInfo | undefined;
  try {
    checkpoint = await recoverCheckpointInfo(record.checkpointId, userId);
  } catch {
    return {
      status: "unknown",
      unknownReason: "The run's checkpoint could not be recovered at settle time.",
    };
  }
  if (!checkpoint) return null;
  let probe = opts.probe;
  if (!probe) {
    try {
      probe = await createWorkspaceTransport(record.projectId, userId, {
        operationId: record.id,
      });
    } catch {
      return {
        status: "unknown",
        unknownReason: "The workspace was not reachable to compare at settle time.",
      };
    }
  }
  try {
    return await computeWorkspaceChange(probe, checkpoint);
  } catch {
    return {
      status: "unknown",
      unknownReason: "The workspace comparison could not be completed at settle time.",
    };
  }
}

/**
 * Persist a settle-time verdict on the run's Activity surface in the
 * SAME shape the loop's own persistence writes (progress-event-
 * persistence's workspace_change mapping), so a run interrupted before
 * its finalize tail shows its verdict in the panel exactly like a
 * completed run does. Best-effort: the verdict is durable on the
 * settle's RunResult regardless — this event is a second surface,
 * never a reason to fail the settle itself.
 */
async function appendWorkspaceChangeEvent(opts: {
  actionRunId: string | null;
  userId: string;
  change: WorkspaceChangeEvidence;
}): Promise<void> {
  if (!opts.actionRunId) return;
  const files = opts.change.files ?? [];
  const diff = opts.change.diff
    ? opts.change.diff.length > 6000
      ? `${opts.change.diff.slice(0, 6000)}…`
      : opts.change.diff
    : undefined;
  try {
    await appendActionEvent({
      runId: opts.actionRunId,
      userId: opts.userId,
      type: "agent.status",
      payload: {
        kind: "workspace_change",
        status: opts.change.status,
        fileCount: files.length,
        files: files.slice(0, 20),
        filesTruncated: files.length > 20,
        ...(opts.change.additions !== undefined ? { additions: opts.change.additions } : {}),
        ...(opts.change.deletions !== undefined ? { deletions: opts.change.deletions } : {}),
        ...(diff !== undefined ? { diff, diffTruncated: (opts.change.diff?.length ?? 0) > 6000 } : {}),
        ...(opts.change.checkpointSha ? { checkpointSha: opts.change.checkpointSha } : {}),
        label:
          opts.change.status === "changed"
            ? `Workspace changed: ${files.length} file${files.length === 1 ? "" : "s"}` +
              (opts.change.additions !== undefined || opts.change.deletions !== undefined
                ? ` (+${opts.change.additions ?? 0}/−${opts.change.deletions ?? 0})`
                : "")
            : `Workspace ${opts.change.status}`,
      },
    });
  } catch {
    // Best-effort by design — see the doc comment above.
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
  const { userId, clerkId } = await auth(req);
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

  // Per-conversation executor serialization (Repair R1a-3, Diagnosis E2
  // S2). Reaching this line with an "approved" decision means this POST
  // is about to spawn a detached resume executor (a pending gate, or a
  // controlled retry). Approval executors register in the studio
  // execution registry at claim time (step 6), so if ANY other
  // execution is already live for this conversation — another gate's
  // resume or a messages-route run — this approval must NOT spawn a
  // second loop on the same lineage. The gate is deliberately NOT
  // resolved here: it stays pending and can be approved again once the
  // live executor settles; the response reports the live run's status,
  // idempotent-style. (This gate's OWN live executor — a duplicate POST
  // — never reaches here: the already-resolved path above returned its
  // status. The key check stays as defense in depth.)
  const approvalExecutionKey = `approval:${pausedRunId}`;
  if (body.decision === "approved") {
    const liveExecution = getActiveExecution(conversationId);
    if (liveExecution && liveExecution.key !== approvalExecutionKey) {
      return NextResponse.json({
        resolved: false,
        decision: "approved",
        status: "processing",
        code: "EXECUTION_ALREADY_ACTIVE",
        pausedRunId,
        runStatus: "processing",
      }, { status: 202 });
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

  // Audit (R3 / E2-Q5): the decision receipt used to be stdout-silent —
  // an approval was auditable only in the DB. Ids + the decision only.
  studioLog("approval:decision_recorded", {
    conversationId,
    userId,
    pausedRunId,
    decision: body.decision,
    status: resolved.status,
  });

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
    // Settle-time verdict (R3 / E4-R4): the rejection ends this run with
    // no finalize tail, but earlier segments of the lineage may already
    // have mutated files. Compute the verdict from the stored
    // checkpoint now and record it on the settle — the record must say
    // what happened to the files even though the gated action itself
    // never ran. No checkpoint → no verdict field (honest absence).
    const rejectionChange = await computeSettleWorkspaceChange({ record: resolved, userId });
    if (rejectionChange) {
      await appendWorkspaceChangeEvent({
        actionRunId: resolved.actionRunId,
        userId,
        change: rejectionChange,
      });
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
      ...(rejectionChange
        ? {
            runResult: {
              finalText: "",
              stepsUsed: resolved.stepsUsed ?? 0,
              toolCalls: [],
              cancelled: true,
              cancelReason: "Approval rejected by user",
              workspaceChange: rejectionChange,
            },
          }
        : {}),
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

  // 5.5. Publish gate (Repair R5-B): an approved DEPLOY may only publish
  // the exact workspace revision that passed verification. Decided HERE
  // — before the claim, before any billing reservation, before any
  // execution — so a denied publish performs no deployment and no
  // charge, structurally. Two ways through:
  //   (a) the run's OWN session carries build evidence (a single run
  //       that built and then paused at its deploy gate): its verdict
  //       is evaluated by the resumed finalize, as before;
  //   (b) the project's canonical record holds a verified revision AND
  //       the live workspace still IS that revision.
  // Otherwise the publish is denied with the truthful reason. This is
  // the gate the post-edit publish needed: the build run verified, the
  // edit run re-verified, and the publish run — whose own fresh session
  // could never contain that evidence — previously had nothing to read
  // but its own empty session, so it failed a publish that should have
  // been allowed; and symmetrically, nothing stopped a publish of
  // content that had changed since verification.
  let publishGateDecision: PublishGateDecision | null = null;
  let publishGateInRun = false;
  if (isDeployToolId(resolved.toolId)) {
    if (sessionHasVerificationEvidence(resolved.qualityLoopState)) {
      publishGateInRun = true;
    } else {
      const record = resolved.projectId
        ? await loadProjectVerifiedRevision({
            userId,
            projectId: resolved.projectId,
            excludeRunId: resolved.actionRunId ?? null,
          })
        : null;
      const currentRevision = await computeWorkspaceRevision(transport);
      const decision = evaluatePublishGate({ record, currentRevision });
      publishGateDecision = decision;
      if (!decision.allowed) {
        studioLog("approval:publish_gate_denied", {
          conversationId,
          userId,
          pausedRunId,
          tool: resolved.toolId,
          // The denial code itself is durable on the settled run
          // record (runResult.publishGate) — the log line names the gate.
          eventType: decision.code,
        });
        await writeResumedResultToTranscript({
          conversationId,
          userId,
          projectId: resolved.projectId,
          pausedRunId,
          status: "failed",
          content: decision.reason,
        });
        await settleResumedRunOutcome({
          record: resolved,
          userId,
          status: "failed",
          eventType: "run.failed",
          patch: {
            currentActivity: decision.reason,
            failureCode: "PUBLISH_NOT_VERIFIED",
            failureMessage: decision.reason,
          },
          runResult: {
            finalText: "",
            stepsUsed: resolved.stepsUsed ?? 0,
            toolCalls: [],
            cancelled: false,
            publishGate: {
              allowed: false,
              code: decision.code,
              verifiedRevision: decision.verifiedRevision,
              currentRevision: decision.currentRevision,
              verifiedByRunId: decision.verifiedByRunId,
            },
          },
          logEvent: "approval:publish_gate_denied_settle_failed",
        });
        return NextResponse.json(
          {
            error: decision.reason,
            code: "PUBLISH_NOT_VERIFIED",
            denial: decision.code,
            resolved: true,
            status: "failed",
            pausedRunId,
          },
          { status: 409 },
        );
      }
    }
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

  // Per-conversation executor serialization (Repair R1a-3, E2 S2),
  // continued: from the claim until the executor settles, this attempt
  // IS the conversation's live execution — register it so the guard
  // above (and the graceful-shutdown snapshot) can see it. The
  // registry identity is server-minted from the gate id: approval POSTs
  // carry no client request id, and the synthetic id can never collide
  // with a client-minted one in the exact-match cancel path. The
  // AbortController is created here (it used to be minted at step 7)
  // because the registration holds it; every later use is unchanged.
  // Unregistration is key-matched, so this attempt's cleanup can never
  // remove a newer execution's entry.
  const abortController = new AbortController();
  registerExecution({
    conversationId,
    userId,
    clientRequestId: approvalExecutionKey,
    assistantMessageId: approvalExecutionKey,
    ...(resolved.actionRunId ? { actionRunId: resolved.actionRunId } : {}),
    controller: abortController,
  });

  // Audit (R3 / E2-Q5): claim/resume start used to exist only as a DB
  // action_event (approval.approved) — never in deployment stdout.
  studioLog("approval:resume_started", {
    conversationId,
    userId,
    pausedRunId,
    actionRunId: resolved.actionRunId ?? undefined,
    tool: resolved.toolId,
  });

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
      unregisterExecution(conversationId, approvalExecutionKey);
      return NextResponse.json(
        { error: "Retry could not start", code: "ACTION_RUNTIME_UNAVAILABLE" },
        { status: 503 },
      );
    }
  }

  if (resolved.actionRunId) {
    await attachActionRunToConversationTask(userId, conversationId, resolved.actionRunId)
      .catch((error) => studioLog("approval:task_attach_failed", {
        conversationId, actionRunId: resolved.actionRunId ?? undefined,
        errorClass: error instanceof Error ? error.message : "unknown",
      }));
  }

  // 6.5. Billing reservation for the approved execution.
  //
  // The original request's reservation is released when the run pauses —
  // no durable reservation can cross the approval boundary without a
  // schema change, and an approval can outlive any request. So the
  // APPROVED execution reserves again here, under a per-attempt
  // idempotency key (`executionToken` is minted once per claim, so a
  // controlled retry gets a fresh key while duplicate approval POSTs can
  // never reach this line — markRunProcessing claims atomically above).
  // The reservation is settled exactly once in the executor's .finally:
  // completed work debits its estimate, failed/cancelled/re-paused work
  // releases the hold. An approved run that debits zero on success is the
  // same defect class as a builtin build that debits zero.
  let resumeRunId: string | null = null;
  let resumeReserved = 0;
  let resumeReservationId: string | null = null;
  let resumeSettle:
    | { status: "completed" | "failed" | "cancelled"; actualCredits: number; error?: string }
    | null = null;
  // The binding quote: computed by the same helper, from the same frozen
  // pausedMessages, that produced the figure disclosed on the approval
  // card at pause time — the reservation below holds exactly the amount
  // the user approved, never a number recomputed after their click.
  const resumeEstimatedBits = computeResumeQuoteBits(resolved.pausedMessages);
  if (clerkId) {
    const reserveResult = await reserveCredits(
      {
        clerkId,
        agentInstanceId: "studio-build",
        agentId: null,
        agentVersionId: null,
        conversationId,
        idempotencyKey: `resume:${pausedRunId}:${executionToken}`,
      },
      resumeEstimatedBits,
    );
    if (!reserveResult.ok) {
      const message = reserveResult.error
        || "Insufficient LiTTBits balance — purchase credits to continue.";
      // Surface the shortfall in the response so the client can render the
      // estimated cost, current balance, and gap — same disclosure the
      // initial-run 402 path provides.
      let shortfall: { estimatedBits: number; balanceBits: number; shortfallBits: number } | null = null;
      try {
        const { getCreditBalances } = await import("@/lib/wallet-ledger");
        const balances = await getCreditBalances(clerkId);
        const balanceBits = Math.round(balances?.total ?? 0);
        shortfall = {
          estimatedBits: resumeEstimatedBits,
          balanceBits,
          shortfallBits: Math.max(0, resumeEstimatedBits - balanceBits),
        };
      } catch { /* disclosure is best-effort */ }
      try {
        await settleResumedRunOutcome({
          record: resolved,
          userId,
          status: "failed",
          eventType: "run.failed",
          patch: {
            currentActivity: message,
            failureCode: "INSUFFICIENT_BALANCE",
            failureMessage: message,
          },
          executionToken,
          logEvent: "approval:action_run_reserve_failed",
        });
      } catch {
        await releaseRunClaim(pausedRunId, userId, executionToken, "failed").catch(
          () => undefined,
        );
      }
      unregisterExecution(conversationId, approvalExecutionKey);
      return NextResponse.json(
        { error: message, resolved: true, status: "failed", pausedRunId, billingQuote: shortfall },
        { status: reserveResult.status || 402 },
      );
    }
    resumeRunId = reserveResult.runId;
    resumeReserved = reserveResult.reservedCredits;
    resumeReservationId = reserveResult.reservationId;
  }

  // Billing for this attempt settles exactly once, from whichever path
  // finishes the attempt first: the executor's .finally below, or the
  // stall watchdog in the heartbeat when the executor never finishes at
  // all. The reservation must never strand because a promise wedged.
  let billingFinalized = false;
  const finalizeResumeBilling = () => {
    if (billingFinalized || !resumeRunId) return;
    billingFinalized = true;
    const settle = resumeSettle
      ?? { status: "failed" as const, actualCredits: 0, error: "EXECUTOR_EXITED_WITHOUT_OUTCOME" };
    settleRun(
      resumeRunId,
      {
        inputTokens: 0,
        outputTokens: 0,
        actualCredits: settle.actualCredits,
        status: settle.status,
        ...(settle.error ? { error: settle.error } : {}),
      },
      resumeReserved,
      resumeReservationId,
    ).catch(() => {
      // Best-effort settlement — must not leak unhandled rejection
    });
  };

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
  // (The AbortController itself was created at registration time, right
  // after the claim — the execution registry holds it.)
  let fenced = false;
  let chainSettled = false;
  let stallWatchdogFired = false;
  let lastProgressAt = new Date().toISOString();
  const heartbeat = setInterval(() => {
    void (async () => {
      // Stall watchdog (D1): the heartbeat is the only clock that
      // watches a claimed run continuously. The executor chain below
      // contains unbounded awaits (workspace/database calls guarded
      // against rejection, not against non-settlement); if one never
      // settles, the promise never settles, this timer keeps the lease
      // fresh forever, and — the read-triggered reaper aside — nothing
      // ever terminates the run: no outcome, no transcript writeback, no
      // log (staging run 00808832 hung exactly this way). Enforce the
      // store's own stall definition here instead: progress frozen past
      // RUN_STALL_MS while the chain is unsettled means the continuation
      // is wedged, so settle the run FAILED with the reaper's recorded
      // reason, through the same writer every other outcome uses.
      if (
        !chainSettled &&
        !stallWatchdogFired &&
        typeof RUN_STALL_MS === "number" &&
        Date.now() - Date.parse(lastProgressAt) > RUN_STALL_MS
      ) {
        stallWatchdogFired = true;
        // Fence FIRST: if the wedged chain ever returns, its .then /
        // .catch must write nothing — this settle is the record now.
        fenced = true;
        abortController.abort();
        clearInterval(heartbeat);
        const message = "Execution stalled (no progress)";
        studioLog("approval:resume_stall_watchdog_fired", {
          conversationId,
          userId,
          pausedRunId,
          actionRunId: resolved.actionRunId ?? undefined,
          latencyMs: Date.now() - Date.parse(lastProgressAt),
        });
        resumeSettle = { status: "failed", actualCredits: 0, error: "EXECUTION_STALLED" };
        // Settle-time verdict (R3 / E4-R4): the wedged chain never
        // reached a finalize tail, so no loop verdict exists — but the
        // approved writes that landed before the wedge are real, and
        // the settled record must say what happened to the files.
        // Computed from the run's stored checkpoint + this route's
        // transport; "unknown" when comparison is impossible.
        const watchdogChange = await computeSettleWorkspaceChange({
          record: resolved,
          userId,
          probe: transport,
        });
        if (watchdogChange) {
          await appendWorkspaceChangeEvent({
            actionRunId: resolved.actionRunId,
            userId,
            change: watchdogChange,
          });
        }
        try {
          await writeResumedResultToTranscript({
            conversationId,
            userId,
            projectId: resolved.projectId,
            pausedRunId,
            status: "failed",
            content: `The resumed run failed: ${message}`,
          });
          await settleResumedRunOutcome({
            record: resolved,
            userId,
            status: "failed",
            eventType: "run.failed",
            patch: { currentActivity: message, failureCode: "EXECUTION_STALLED", failureMessage: message },
            ...(watchdogChange
              ? {
                  runResult: {
                    finalText: "",
                    stepsUsed: resolved.stepsUsed ?? 0,
                    toolCalls: [],
                    cancelled: false,
                    workspaceChange: watchdogChange,
                  },
                }
              : {}),
            executionToken,
            logEvent: "approval:action_run_stall_watchdog_settle_failed",
          });
        } catch {
          await releaseRunClaim(pausedRunId, userId, executionToken, "failed").catch(
            () => undefined,
          );
        } finally {
          finalizeResumeBilling();
          // The watchdog's settle IS this executor's terminal record —
          // release the conversation registration here too, since a
          // wedged chain may never reach its own .finally (R1a-3).
          unregisterExecution(conversationId, approvalExecutionKey);
        }
        return;
      }
      const alive = await renewRunLease(pausedRunId, userId, executionToken, lastProgressAt)
        .catch(() => undefined);
      if (alive === false) {
        fenced = true;
        abortController.abort();
      }
    })();
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
      unregisterExecution(conversationId, approvalExecutionKey);
      return NextResponse.json({ error: message, code: "ACTION_RUNTIME_UNAVAILABLE" }, { status: 503 });
    }
  }

  // Static-workspace truth for the resumed run's tool-health filtering.
  // The initial run gets this from its canonical context; the resume must
  // re-derive it or the resumed loop re-advertises tools that cannot
  // execute in a static workspace (terminal, preview dev server). A
  // failed lookup falls back to undefined (pre-fix behavior), never to a
  // guessed value.
  const resumeProject = resolved.projectId
    ? await getProject(resolved.projectId, userId).catch(() => null)
    : null;

  const resumeConfig: Partial<AgentLoopConfig> = {
    systemPrompt: resolved.systemPrompt,
    executionMode: resolved.executionMode,
    enableBuildFix: true,
    signal: abortController.signal,
    userId,
    // Disclose the same estimate the approval authorized: the reservation
    // above holds exactly this amount and the settlement is capped at it,
    // so the approval card's quote, the held amount, and the maximum
    // possible debit are the same number.
    billingEstimateBits: resumeEstimatedBits,
    isStaticWorkspace: resumeProject?.framework === "static" ? true : undefined,
    // Item 5a — persist the resumed loop's ProgressEvents to the parent
    // run's action_events log, the same Activity truth as the initial run.
    // resumeAgentLoopV2Inner spreads resume.config into cfg, so the hook
    // reaches the loop's persistence chain unchanged.
    persistEvent: actionContext
      ? makePersistProgressEvent({ runId: actionContext.actionRunId, userId })
      : undefined,
    // Conversation scope — injected into browser.start_session so the
    // resumed run reuses the live browser session from before the pause.
    conversationId,
    actionContext,
    // Build capability guard: a run that paused on a file-write approval is
    // a BUILD run. Resume with the guard enabled so a model that stops
    // writing files gets ruled out within 3 steps instead of burning the
    // run budget — the same protection the main loop gets via launch-flow.
    buildCapabilityGuard: isFileWritingTool(resolved.toolId)
      ? { maxStepsWithoutFileWrite: 3 }
      : undefined,
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

  // The paused-run record persists only the checkpointId — recover the
  // real pre-mutation baseline from the checkpoint row (the durable
  // source of truth) and thread it into the resume. See
  // recoverCheckpointInfo for the manifest/git recovery semantics.
  const resumeCheckpoint = await recoverCheckpointInfo(resolved.checkpointId, userId);

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
        // record — write nothing, let the recorded outcome stand. Our
        // reservation is released: an aborted executor never debits.
        resumeSettle = { status: "cancelled", actualCredits: 0, error: "FENCED" };
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
        } else if (isFileWritingTool(resolved.toolId) && !approvedEditLanded(result, resolved)) {
          // Repair R5-C (resume side): the approved action was a file
          // edit, yet the resumed segment does not prove THAT edit
          // landed — the gated call never executed successfully
          // (dropped, filtered, or the model talked instead), it wrote
          // to a different file than the approved target, or the
          // workspace verdict proves nothing changed (no-op). The
          // segment must not settle as a completed edit: an unlanded
          // change was not applied.
          resumeFailure = "The approved edit did not change any files, so the change was not applied.";
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
            { workspaceChange: result.workspaceChange ?? null, hadSuccessfulMutation: successfulMutation, isStaticWorkspace: resumeConfig.isStaticWorkspace },
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
          { hadSuccessfulMutation: successfulMutation, isStaticWorkspace: resumeConfig.isStaticWorkspace },
          undefined,
          actionContext,
        ).catch(() => null);
      }

      if (resumeFailure) {
        resumeSettle = { status: "failed", actualCredits: 0, error: resumeFailure };
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
        // failure). The claim is verified and released inside. The
        // RunResult rides along (R3): this failure settle used to record
        // NO result, so the loop's own verdict — computed in its
        // finalize tail against the original baseline — was dropped
        // precisely on the runs that failed.
        await settleResumedRunOutcome({
          record: resolved,
          userId,
          status: "failed",
          eventType: "run.failed",
          patch: { currentActivity: "Task failed", failureCode: "TASK_FAILED", failureMessage: resumeFailure },
          runResult: {
            finalText: result.finalText,
            stepsUsed: result.stepsUsed,
            toolCalls: result.toolCalls,
            cancelled: result.cancelled,
            cancelReason: result.cancelReason,
            qualityLoop: result.qualityLoop
              ? {
                  verdict: result.qualityLoop.verdict,
                  stages: result.qualityLoop.stages,
                  designPasses: result.qualityLoop.designPasses,
                }
              : undefined,
            qualityLoopState: result.qualityLoopState,
            workspaceChange: result.workspaceChange ?? null,
          },
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
        const previewUrl = resumeConfig.isStaticWorkspace
          ? `/api/preview/${encodeURIComponent(resolved.projectId)}/`
          : buildPreviewProxyUrl(transport.workspaceId);
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

      // Publish-gate settle revalidation (R5-B): the pre-execution gate
      // allowed this deploy because the workspace WAS the verified
      // revision. Recompute the revision at settle: the settle is
      // covered only if the workspace is still exactly a revision some
      // ok verdict covers — the gate's verified revision, or the
      // revision this segment's own finalize computed under its ok
      // verdict (the publish run's own session verdict is structurally
      // unable to contain the earlier runs' build/test evidence, and
      // must not by itself fail a publish of verified bytes — that
      // asymmetry WAS Defect 2). An ok verdict alone is NOT coverage:
      // if the workspace at settle matches neither revision — it moved
      // under the publish, or can no longer be read — what shipped is
      // not proven to be the verified content, and the settle fails
      // truthfully instead of recording an allowed audit over
      // mismatched revisions (verification gap G1).
      let publishGateAudit: RunResult["publishGate"] = null;
      let publishGateCoversSettle = false;
      const segmentIsDeploy =
        isDeployToolId(resolved.toolId) ||
        result.toolCalls.some((call) => isDeployToolId(call.toolId));
      if (publishGateDecision?.allowed) {
        const settleRevision = await computeWorkspaceRevision(transport);
        const segmentVerifiedRevision =
          qualityLoop?.verdict.ok === true ? (result.workspaceRevision ?? null) : null;
        if (
          settleRevision !== null &&
          settleRevision === segmentVerifiedRevision &&
          settleRevision !== publishGateDecision.currentRevision
        ) {
          publishGateCoversSettle = true;
          publishGateAudit = {
            allowed: true,
            code: "in_run_verification",
            verifiedRevision: segmentVerifiedRevision,
            currentRevision: settleRevision,
            verifiedByRunId: publishGateDecision.verifiedByRunId,
          };
        } else if (settleRevision !== null && settleRevision === publishGateDecision.currentRevision) {
          publishGateCoversSettle = true;
          publishGateAudit = {
            allowed: true,
            code: publishGateDecision.code,
            verifiedRevision: publishGateDecision.verifiedRevision,
            currentRevision: settleRevision,
            verifiedByRunId: publishGateDecision.verifiedByRunId,
          };
        } else {
          publishGateAudit = {
            allowed: false,
            code: settleRevision === null ? "current_revision_unknown" : "stale_revision",
            verifiedRevision: publishGateDecision.verifiedRevision,
            currentRevision: settleRevision,
            verifiedByRunId: publishGateDecision.verifiedByRunId,
          };
        }
      } else if (publishGateInRun) {
        publishGateAudit = {
          allowed: qualityLoop?.verdict.ok === true,
          code: "in_run_verification",
          verifiedRevision:
            qualityLoop?.verdict.ok === true ? (result.workspaceRevision ?? null) : null,
          currentRevision: null,
          verifiedByRunId: null,
        };
      }

      // A stale settle audit (the gate allowed the publish, then the
      // workspace moved or became unreadable before settle) fails the
      // run regardless of the segment's own verdict state — including
      // when the segment produced no verdict at all (verification gap
      // G1). The in-run audit is exempt: its not-allowed state simply
      // mirrors the segment's own not-ok verdict, which the quality
      // branch below reports with the quality wording.
      const gateStaleFailure =
        publishGateAudit && !publishGateAudit.allowed && publishGateAudit.code !== "in_run_verification" && segmentIsDeploy
          ? "The workspace changed while publishing, so what would be published is no longer the verified revision. Re-run verification, then publish again."
          : undefined;
      const terminalFailure = result.failedHonestly || gateStaleFailure ||
        (!result.pendingApproval && qualityLoop && !qualityLoop.verdict.ok
          ? publishGateCoversSettle && segmentIsDeploy
            ? undefined
            : "The build did not pass its quality checks; it is not complete."
          : undefined);

      // Termination attribution (R4/E3-S1): the loop's `cancelled` flag
      // mostly means a NON-user stop — max steps, max output,
      // repeated-call detection, the zero-call stall, max runtime, or a
      // shutdown abort. Only a stop whose cancelReason is the user-stop
      // reason may be recorded as a user cancellation; every other loop
      // stop settles FAILED carrying its real reason. Billing is
      // identical either way (0 credits) — only the recorded truth
      // changes. Before this, any cancelled=true manufactured
      // "Task cancelled by user" on the canonical record.
      const userCancelled = result.cancelled && isUserCancelReason(result.cancelReason);
      const loopStopped = result.cancelled && !userCancelled;
      const stopReason = result.cancelReason ?? "The run stopped before completing.";

      // Reflect the final outcome on the transcript BEFORE marking the run
      // completed — a poller that sees "completed" can then loadMessages
      // and get the real persisted result. An honest loop failure is
      // reported as failed, never completed.
      await writeResumedResultToTranscript({
        conversationId,
        userId,
        projectId: resolved.projectId,
        pausedRunId,
        status: userCancelled
          ? "cancelled"
          : loopStopped
            ? "failed"
            : result.pendingApproval
              ? "awaiting_approval"
              : terminalFailure
                ? "failed"
                : "completed",
        content: (terminalFailure || finalText) || undefined,
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
        // The verdict (R3 / E4-S5): the loop computed this in its
        // finalize tail against the ORIGINAL baseline (R2 continuity).
        // Before this field existed on RunResult, the value died here —
        // the settled record carried no workspace truth at all.
        workspaceChange: result.workspaceChange ?? null,
        // The verified revision (R5-B): bind an ok verdict to the exact
        // workspace revision it covers, so a later publish can prove
        // the bytes it ships are the bytes that were verified. A
        // non-ok verdict records null — never a dressed-up claim.
        verifiedRevision:
          qualityLoop?.verdict.ok === true ? (result.workspaceRevision ?? null) : null,
        publishGate: publishGateAudit,
      };

      // Nested-gate handoff: persist the new gate, then record the outer
      // attempt's outcome and the waiting_for_user transition in ONE atomic
      // RPC. The derived outcome (getRunOutcomeForPausedRun) reads the
      // approval.required event's payload.result and reports this gate as
      // completed with the nested gate's pausedRunId.
      if (result.pendingApproval) {
        let nestedPausedRunId: string;
        // The nested card discloses its own resume cost before the user
        // approves it — same contract as the first gate. One disclosed
        // reason, used for the stored record AND the outcome payload the
        // client renders the next card from.
        const nestedDisclosedReason =
          result.pendingApproval.reason + resumeQuoteDisclosure(result.pendingApproval.pausedMessages);
        try {
          const nested = await createPausedRun({
            userId,
            conversationId,
            projectId: resolved.projectId,
            workspaceId: resolved.workspaceId,
            toolId: result.pendingApproval.toolId,
            toolCallId: result.pendingApproval.toolCallId,
            inputs: result.pendingApproval.inputs,
            reason: nestedDisclosedReason,
            pausedMessages: result.pendingApproval.pausedMessages,
            executionMode: resolved.executionMode,
            systemPrompt: resolved.systemPrompt,
            // Checkpoint continuity (R2/E4-S2): a nested gate must carry the
            // SAME baseline the chain started with — the resume result's
            // checkpoint is the baseline this segment was threaded (or the
            // first baseline it established), mirroring the messages route's
            // first-pause persistence. Hardcoding null here stranded every
            // resume from gate ≥2 with no baseline, so its finalize-tail
            // verdict could only answer "unknown" and no build with two or
            // more approvals could ever produce a truthful end-to-end verdict.
            checkpointId: result.checkpoint?.checkpointId ?? null,
            actionRunId: resolved.actionRunId ?? null,
            qualityLoopState: result.pendingApproval.qualityLoopState,
            deferredToolCalls: result.pendingApproval.deferredToolCalls,
            stepsUsed: result.pendingApproval.stepsUsedAtPause,
            hadInterveningMutation: result.pendingApproval.hadInterveningMutationAtPause,
          });
          nestedPausedRunId = nested.id;
          // Audit (R3 / E2-Q5): nested gate creation used to log only
          // on FAILURE — a successful chain of gates was invisible in
          // stdout. The line names the NEW gate's id.
          studioLog("approval:nested_gate_created", {
            conversationId,
            userId,
            pausedRunId: nestedPausedRunId,
            actionRunId: resolved.actionRunId ?? undefined,
            tool: result.pendingApproval.toolId,
          });
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
          resumeSettle = { status: "failed", actualCredits: 0, error: nestedPersistError };
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
          reason: nestedDisclosedReason,
        };
        // Re-paused on a nested gate — release this attempt's reservation;
        // approving the nested gate reserves again under its own key.
        resumeSettle = { status: "cancelled", actualCredits: 0, error: "PAUSED_FOR_NESTED_APPROVAL" };
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
      const honestFailure = terminalFailure;
      resumeSettle = userCancelled
        ? { status: "cancelled", actualCredits: 0 }
        : loopStopped
          ? { status: "failed", actualCredits: 0, error: stopReason }
          : honestFailure
            ? { status: "failed", actualCredits: 0, error: honestFailure }
            : {
                status: "completed",
                // Same estimate formula as the initial request — capped by
                // the reservation so the settle can never exceed the quote.
                actualCredits: Math.min(
                  estimateCredits(
                    Math.ceil(JSON.stringify(resolved.pausedMessages ?? []).length / 4),
                    Math.ceil((finalText ?? "").length / 4),
                    1,
                    1,
                  ),
                  resumeReserved,
                ),
              };
      await settleResumedRunOutcome({
        record: resolved,
        userId,
        status: userCancelled ? "cancelled" : honestFailure || loopStopped ? "failed" : "completed",
        eventType: userCancelled ? "run.cancelled" : honestFailure || loopStopped ? "run.failed" : "run.completed",
        patch: {
          currentActivity: userCancelled
            ? "Task cancelled by user"
            : loopStopped
              ? `Task stopped — ${stopReason}`
              : honestFailure
                ? "Task failed"
                : "Task completed",
          approvalReference: null,
          failureCode: loopStopped ? "EXECUTION_STOPPED" : honestFailure ? "TASK_FAILED" : null,
          failureMessage: loopStopped
            ? stopReason.slice(0, 500)
            : honestFailure
              ? honestFailure.slice(0, 500)
              : null,
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
      if (fenced) {
        resumeSettle = { status: "cancelled", actualCredits: 0, error: "FENCED" };
        return;
      }
      const message = err instanceof Error ? err.message : "Resume failed";
      resumeSettle = { status: "failed", actualCredits: 0, error: message };
      await writeResumedResultToTranscript({
        conversationId,
        userId,
        projectId: resolved.projectId,
        pausedRunId,
        status: "failed",
        content: `The resumed run failed: ${message}`,
      });
      // Settle-time verdict (R3 / E4-R4): the loop threw, so its
      // finalize tail never produced a verdict. Compute it here from
      // the threaded baseline + transport so the failure record still
      // states what happened to the files.
      const exceptionChange = await computeSettleWorkspaceChange({
        record: resolved,
        userId,
        probe: transport,
      });
      if (exceptionChange) {
        await appendWorkspaceChangeEvent({
          actionRunId: resolved.actionRunId,
          userId,
          change: exceptionChange,
        });
      }
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
          ...(exceptionChange
            ? {
                runResult: {
                  finalText: "",
                  stepsUsed: resolved.stepsUsed ?? 0,
                  toolCalls: [],
                  cancelled: false,
                  workspaceChange: exceptionChange,
                },
              }
            : {}),
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
      // way; stop proving liveness and disarm the stall watchdog. A
      // fenced executor dies here too.
      chainSettled = true;
      clearInterval(heartbeat);
      // Release the per-conversation registration (R1a-3): the attempt
      // is fully settled, so the next gate's approval may spawn. If the
      // stall watchdog already settled this attempt, it unregistered
      // there and this key-matched call is a no-op.
      unregisterExecution(conversationId, approvalExecutionKey);
      // Settle this attempt's billing reservation exactly once (shared
      // with the stall watchdog, which finalizes first if the chain
      // never settled). A missing outcome means the executor exited
      // without recording truth — release the hold rather than
      // stranding reserved bits.
      finalizeResumeBilling();
    });

  // 8. Return 202 Accepted immediately — the execution continues in the background
  return NextResponse.json({
    resolved: true,
    decision: "approved",
    status: "processing",
    pausedRunId,
    runStatus: "processing",
    billingQuote: clerkId ? { estimatedBits: resumeReserved } : null,
  }, { status: 202 });
}

/**
 * GET /api/studio/conversations/[conversationId]/approvals/[pausedRunId]
 * Get the status of a paused run, including async execution state.
 *
 * Returns:
 *   - status: "pending" | "approved" | "rejected" | "expired"
 *   - runStatus: null | "processing" | "completed" | "failed" | "cancelled"
 *   - runResult: the resumed execution result (when completed)
 *   - runError: error message (when failed)
 *   - pendingApproval: the run's live nested gate, when the resumed
 *     segment re-paused at a different paused run (R4/E1-F3)
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

  // The run's LIVE nested gate (R4/E1-F3): a resumed segment that paused
  // again is waiting on the user at a NEW paused run. Pollers keyed to
  // THIS gate must learn about it from the poll contract itself — the
  // handoff nested in this gate's RunResult is the primary path, but a
  // gate whose handoff event falls outside the outcome read window
  // (or whose outcome still reads "processing") must not leave the
  // client parked in "executing" until the 15-minute poll timeout
  // while the server waits on the user. Surface the live sibling gate
  // at top level whenever this gate's outcome is not settled.
  let pendingApproval: { toolId: string; pausedRunId: string; reason: string } | null = null;
  const nested = outcome.runResult?.pendingApproval;
  if (nested?.pausedRunId && nested.pausedRunId !== pausedRunId) {
    pendingApproval = {
      toolId: nested.toolId,
      pausedRunId: nested.pausedRunId,
      reason: nested.reason,
    };
  } else if (
    (outcome.runStatus === "processing" || outcome.runStatus === null) &&
    pausedRun.actionRunId
  ) {
    try {
      const siblings = await listPausedRunsForActionRun(pausedRun.actionRunId, userId);
      const live = siblings.find((s) => s.status === "pending" && s.id !== pausedRunId);
      if (live) {
        pendingApproval = { toolId: live.toolId, pausedRunId: live.id, reason: live.reason };
      }
    } catch {
      // Best-effort handoff surface: the outcome fields above remain the
      // authority; a sibling lookup failure never fails the poll.
    }
  }

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
    pendingApproval,
  });
}
