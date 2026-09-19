/**
 * Paused Run Store — server-side persistence for V2 agent loop runs that
 * paused for ACT-mode approval.
 *
 * Security properties:
 * - Never trusts client-supplied paused state. All state is server-verified.
 * - Approvals are single-use: once resolved, they cannot be replayed.
 * - Approvals expire after APPROVAL_TTL_MS.
 * - Tool arguments are frozen at pause time. The approve endpoint cannot
 *   replace them.
 * - On resume, user ownership and workspace state are re-verified.
 *
 * Async execution:
 * - After approval, the resumed agent loop runs detached from the HTTP
 *   request. Its state is persisted in run_status / run_result / run_error
 *   so the client can poll the GET endpoint for completion.
 * - A claimed run is lease-owned: the executor renews lease_expires_at
 *   every RUN_HEARTBEAT_MS and carries its last observed progress on the
 *   same write. A dead process provably lapses in ≤ RUN_LEASE_MS; a live
 *   process working past the old age wall is never condemned.
 * - Terminal writes are fenced on execution_token, so a superseded or
 *   stale-marked executor cannot overwrite the truth — and a fenced
 *   executor learns it lost the claim on its next beat and aborts.
 * - Runs that provably died (lease expired) or genuinely stalled
 *   (RUN_STALL_MS without progress) are marked failed on read; only a
 *   run whose lease has lapsed may be reset and re-driven.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import type { LLMMessage } from "./llm-tool-calling";
import type { DeferredToolCall } from "./agent-loop-v2";
import type { QualityFinale, QualityLoopSnapshot } from "./quality-loop-flow";

/**
 * How long a human has to decide on an approval gate.
 *
 * 30 minutes: generous on purpose. Approvals arrive on a phone — the user
 * may be mid-task, on a call, or away from the screen. A 5-minute TTL
 * expired gates before people could act, and every expiry dead-ended the
 * run ("send the request again"). The gate stays single-use and
 * server-authoritative; only the decision window is humane.
 */
const APPROVAL_TTL_MS = 30 * 60 * 1000; // 30 minutes
const TABLE = "agent_paused_runs";

/** A run that has been "processing" longer than this is considered stale
 *  (the process likely restarted). The GET endpoint marks it as failed.
 *  Only applies to rows with no lease — lease-bearing executors prove
 *  liveness continuously and are judged by lease expiry + progress, not age. */
export const RUN_STALE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Executor lease for a resumed run. The detached executor renews
 * lease_expires_at = now + RUN_LEASE_MS every RUN_HEARTBEAT_MS, so a live
 * process keeps its lease ~3 beats ahead. A dead process stops renewing and
 * the lease lapses in ≤90s — provable death, an order of magnitude faster
 * than the legacy 10-minute age guess.
 */
export const RUN_LEASE_MS = 90_000;
export const RUN_HEARTBEAT_MS = 30_000;

/**
 * Genuine-stall detector: the executor's lease can stay fresh (process
 * alive, event loop healthy) while the agent loop itself is wedged — a hung
 * provider call, a repair-loop livelock. Progress events update
 * last_progress_at on every heartbeat; if it stops advancing for this long
 * while the lease is fresh, the run is stalled, not working.
 *
 * Sized ABOVE DEFAULT_LOOP_CONFIG.maxRuntimeMs (10 min): the loop's own
 * graceful runtime budget must always win over the stall detector, so this
 * only fires when something escaped the budget entirely.
 */
export const RUN_STALL_MS = 12 * 60 * 1000;

export type RunStatus = "processing" | "completed" | "failed" | null;

export interface RunResult {
  finalText: string;
  stepsUsed: number;
  toolCalls: Array<{ toolId: string; success: boolean; summary: string; mutating: boolean }>;
  cancelled: boolean;
  cancelReason?: string;
  pendingApproval?: {
    toolId: string;
    pausedRunId?: string;
    reason: string;
  };
  /**
   * Quality-loop finale for ACT-mode runs that opted into the gated loop.
   * Durably persists the machine-readable answer to "is this actually good
   * enough to ship?" (verdict + per-stage evidence state) on the run
   * record. Optional for backwards compatibility — runs recorded before
   * the quality loop existed simply lack it.
   */
  qualityLoop?: Pick<QualityFinale, "verdict" | "stages" | "designPasses">;
  /** Evidence ledger captured before a pause, including pending observations. */
  qualityLoopState?: QualityLoopSnapshot;
}

export interface PausedRunRecord {
  id: string;
  userId: string;
  conversationId: string;
  projectId: string;
  workspaceId: string;
  toolId: string;
  toolCallId: string;
  inputs: Record<string, unknown>;
  reason: string;
  pausedMessages: LLMMessage[];
  executionMode: "plan" | "act" | "auto";
  systemPrompt: string;
  checkpointId: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  // Async execution tracking (null when not yet started)
  runStatus: RunStatus;
  runResult: RunResult | null;
  runError: string | null;
  runStartedAt: string | null;
  runCompletedAt: string | null;
  /**
   * Fencing token minted at claim time. Renewals and terminal writes are
   * conditioned on it, so a superseded executor (or a stale-marked zombie)
   * can never overwrite the truth owned by the current claim.
   */
  executionToken: string | null;
  /** Executor-owned deadline — renewed while the process is alive. */
  leaseExpiresAt: string | null;
  /**
   * Last time the executor observed real progress (a step/tool event),
   * carried on each heartbeat. Fresh lease + frozen progress = wedged loop.
   */
  lastProgressAt: string | null;
  qualityLoopState?: QualityLoopSnapshot;
  /**
   * The unexecuted remainder of the tool batch that hit the approval gate,
   * captured at pause time and re-injected after the approved tool runs on
   * resume. Absent (legacy rows) means "no deferred calls recorded".
   */
  deferredToolCalls?: DeferredToolCall[];
  /** Steps used before the pause — resume continues the budget from here. */
  stepsUsed?: number;
  /** Whether any mutation had executed before the pause. */
  hadInterveningMutation?: boolean;
}

interface PausedRunRow {
  id: string;
  user_id: string;
  conversation_id: string;
  project_id: string;
  workspace_id: string;
  tool_id: string;
  tool_call_id: string;
  inputs: Record<string, unknown>;
  reason: string;
  paused_messages: LLMMessage[];
  execution_mode: string;
  system_prompt: string;
  checkpoint_id: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  run_status: string | null;
  run_result: RunResult | null;
  run_error: string | null;
  run_started_at: string | null;
  run_completed_at: string | null;
  execution_token?: string | null;
  lease_expires_at?: string | null;
  last_progress_at?: string | null;
  quality_loop_state?: QualityLoopSnapshot | null;
  deferred_tool_calls?: DeferredToolCall[] | null;
  steps_used?: number | null;
  had_intervening_mutation?: boolean | null;
}

function rowToRecord(row: PausedRunRow): PausedRunRecord {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    toolId: row.tool_id,
    toolCallId: row.tool_call_id,
    inputs: row.inputs,
    reason: row.reason,
    pausedMessages: row.paused_messages,
    executionMode: row.execution_mode as "plan" | "act" | "auto",
    systemPrompt: row.system_prompt,
    checkpointId: row.checkpoint_id,
    status: row.status as PausedRunRecord["status"],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    runStatus: (row.run_status as RunStatus) ?? null,
    runResult: row.run_result ?? null,
    runError: row.run_error ?? null,
    runStartedAt: row.run_started_at ?? null,
    runCompletedAt: row.run_completed_at ?? null,
    executionToken: row.execution_token ?? null,
    leaseExpiresAt: row.lease_expires_at ?? null,
    lastProgressAt: row.last_progress_at ?? null,
    qualityLoopState: row.quality_loop_state ?? undefined,
    deferredToolCalls: row.deferred_tool_calls ?? undefined,
    stepsUsed: row.steps_used ?? undefined,
    hadInterveningMutation: row.had_intervening_mutation ?? undefined,
  };
}

export async function createPausedRun(input: {
  userId: string;
  conversationId: string;
  projectId: string;
  workspaceId: string;
  toolId: string;
  toolCallId: string;
  inputs: Record<string, unknown>;
  reason: string;
  pausedMessages: LLMMessage[];
  executionMode: "plan" | "act" | "auto";
  systemPrompt: string;
  checkpointId: string | null;
  qualityLoopState?: QualityLoopSnapshot;
  deferredToolCalls?: DeferredToolCall[];
  stepsUsed?: number;
  hadInterveningMutation?: boolean;
}): Promise<PausedRunRecord> {
  if (!supabaseAdmin) throw new Error("Database not available");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS);

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({
      user_id: input.userId,
      conversation_id: input.conversationId,
      project_id: input.projectId,
      workspace_id: input.workspaceId,
      tool_id: input.toolId,
      tool_call_id: input.toolCallId,
      inputs: input.inputs,
      reason: input.reason,
      paused_messages: input.pausedMessages,
      execution_mode: input.executionMode,
      system_prompt: input.systemPrompt,
      checkpoint_id: input.checkpointId,
      status: "pending",
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      resolved_at: null,
      quality_loop_state: input.qualityLoopState ?? null,
      deferred_tool_calls: input.deferredToolCalls ?? null,
      steps_used: input.stepsUsed ?? null,
      had_intervening_mutation: input.hadInterveningMutation ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create paused run: ${error?.message ?? "unknown"}`);
  }

  return rowToRecord(data as PausedRunRow);
}

/**
 * A pending row past its TTL is dead — flip it to "expired" durably and
 * return the truthful status. Without this, a never-decided gate reports
 * "pending" forever (no sweep calls expireStaleRuns), so the GET poll
 * endpoint and the client watcher never converge and the approval card
 * stays mounted on a gate that can no longer be actioned.
 */
async function expireIfStale(record: PausedRunRecord): Promise<PausedRunRecord> {
  if (record.status !== "pending" || !supabaseAdmin) return record;
  if (new Date(record.expiresAt).getTime() >= Date.now()) return record;

  const now = new Date().toISOString();
  await supabaseAdmin
    .from(TABLE)
    .update({ status: "expired", resolved_at: now })
    .eq("id", record.id)
    .eq("status", "pending");
  return { ...record, status: "expired", resolvedAt: now };
}

/**
 * Stale-run recovery: an approved run whose detached execution was killed
 * mid-flight (deploy/restart) stays "processing" forever and never writes
 * back to the transcript. Any read past RUN_STALE_TIMEOUT_MS marks it
 * failed so the GET poll endpoint and the transcript reconciler converge
 * on the truth. Also covers the narrower window where the process died
 * after the atomic decision but before markRunProcessing (approved with
 * runStatus still null long after resolvedAt).
 */
async function recoverStaleRun(record: PausedRunRecord): Promise<PausedRunRecord> {
  if (!supabaseAdmin || record.status !== "approved") return record;

  let staleError: string | null = null;
  if (record.runStatus === "processing" && record.runStartedAt) {
    if (record.leaseExpiresAt) {
      // Lease-bearing executor: judge by liveness, not age. A run doing
      // legitimate work renews its lease ~3 heartbeats ahead — it can run
      // well past the old 10-minute wall without being condemned.
      const leaseAt = Date.parse(record.leaseExpiresAt);
      if (Number.isFinite(leaseAt) && leaseAt < Date.now()) {
        // Heartbeats stopped → the process is provably gone.
        staleError = "Execution lost (worker may have restarted)";
      } else if (record.lastProgressAt) {
        // Process alive but the loop produced nothing for RUN_STALL_MS —
        // wedged, not working. Deliberately longer than the loop's own
        // maxRuntimeMs so the graceful timeout always wins first.
        const progressAt = Date.parse(record.lastProgressAt);
        if (Number.isFinite(progressAt) && Date.now() - progressAt > RUN_STALL_MS) {
          staleError = "Execution stalled (no progress)";
        }
      }
    } else {
      // Row claimed before leases existed (e.g. mid-deploy): the legacy
      // age rule is the only signal available.
      const startedAt = Date.parse(record.runStartedAt);
      if (Number.isFinite(startedAt) && Date.now() - startedAt > RUN_STALE_TIMEOUT_MS) {
        staleError = "Execution timed out (process may have restarted)";
      }
    }
  } else if (record.runStatus === null && record.resolvedAt) {
    const resolvedAt = Date.parse(record.resolvedAt);
    if (Number.isFinite(resolvedAt) && Date.now() - resolvedAt > RUN_STALE_TIMEOUT_MS) {
      staleError = "Execution never started (process may have restarted)";
    }
  }
  if (!staleError) return record;

  // Guarded write: only flip the state this read actually saw. A racing
  // executor that just wrote a terminal state must never be clobbered.
  const failedAt = new Date().toISOString();
  const update = supabaseAdmin
    .from(TABLE)
    .update({
      run_status: "failed",
      run_error: staleError,
      run_completed_at: failedAt,
    })
    .eq("id", record.id)
    .eq("user_id", record.userId);
  if (record.runStatus === "processing") {
    update.eq("run_status", "processing");
  } else {
    update.is("run_status", null);
  }
  await update;
  return {
    ...record,
    runStatus: "failed",
    runError: staleError,
    runCompletedAt: failedAt,
  };
}

export async function getPausedRun(
  pausedRunId: string,
  userId: string,
): Promise<PausedRunRecord | null> {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("id", pausedRunId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  const record = await expireIfStale(rowToRecord(data as PausedRunRow));
  return recoverStaleRun(record);
}

/**
 * Latest still-pending paused run for a conversation — used to rehydrate
 * the approval card after a page reload (the in-memory execution store is
 * gone, but the paused run row survives). Returns null when nothing is
 * resumable.
 */
export async function getPendingPausedRunForConversation(
  conversationId: string,
  userId: string,
): Promise<PausedRunRecord | null> {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return rowToRecord(data as PausedRunRow);
}

/**
 * Newest paused run for a conversation regardless of status — used to
 * reconcile a transcript message whose gate died without a writeback
 * (expired TTL, a rejection writeback that missed). Pending-but-expired
 * rows are normalized to "expired" so callers never mistake a dead gate
 * for an actionable one.
 */
export async function getLatestPausedRunForConversation(
  conversationId: string,
  userId: string,
): Promise<PausedRunRecord | null> {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return recoverStaleRun(await expireIfStale(rowToRecord(data as PausedRunRow)));
}

export async function resolvePausedRun(
  pausedRunId: string,
  userId: string,
  decision: "approved" | "rejected",
): Promise<PausedRunRecord | null> {
  if (!supabaseAdmin) throw new Error("Database not available");

  // Single-use: only update if still pending
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({
      status: decision,
      resolved_at: now,
    })
    .eq("id", pausedRunId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve paused run: ${error.message}`);
  }

  if (!data) {
    // Either not found, wrong user, or already resolved
    return null;
  }

  const record = rowToRecord(data as PausedRunRow);

  // Check expiration
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    // Mark as expired instead
    await supabaseAdmin
      .from(TABLE)
      .update({ status: "expired", resolved_at: now })
      .eq("id", pausedRunId)
      .eq("status", decision);
    return null;
  }

  return record;
}

/**
 * Mark a run as "processing" — the resumed execution has started.
 * Only transitions from null (not yet started) to "processing".
 * This is idempotent: if already processing, it's a no-op.
 *
 * The claim mints the fencing token and the first lease + progress mark.
 * From here the executor proves liveness by renewal; nothing else may
 * write terminal state without presenting this token.
 */
export async function markRunProcessing(
  pausedRunId: string,
  userId: string,
  executionToken: string,
): Promise<boolean> {
  if (!supabaseAdmin) return false;

  const now = new Date();
  const nowIso = now.toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({
      run_status: "processing",
      run_started_at: nowIso,
      execution_token: executionToken,
      lease_expires_at: new Date(now.getTime() + RUN_LEASE_MS).toISOString(),
      last_progress_at: nowIso,
    })
    .eq("id", pausedRunId)
    .eq("user_id", userId)
    .is("run_status", null) // Only if not yet started (NULL check requires .is, not .eq)
    .select("id")
    .maybeSingle();

  if (error) return false;
  return !!data;
}

/**
 * Executor heartbeat. Renews the lease and carries the executor's latest
 * observed progress timestamp in one write.
 *
 * Returns true only when this token still owns a live claim. False means
 * fenced — the run was marked failed/completed by someone else (stale
 * detector, stall detector, or a newer claim) — and the executor must
 * abort. A thrown error (transient DB failure) is NOT a fence: the caller
 * should keep working and retry the next beat; if the DB stays down the
 * lease will lapse and a later successful beat will report the fence.
 */
export async function renewRunLease(
  pausedRunId: string,
  userId: string,
  executionToken: string,
  lastProgressAt: string,
): Promise<boolean> {
  if (!supabaseAdmin) return false;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({
      lease_expires_at: new Date(Date.now() + RUN_LEASE_MS).toISOString(),
      last_progress_at: lastProgressAt,
    })
    .eq("id", pausedRunId)
    .eq("user_id", userId)
    .eq("execution_token", executionToken)
    .eq("run_status", "processing")
    .select("id")
    .maybeSingle();

  if (error) {
    // Transient failure is not proof of fencing — surface it so the caller
    // can distinguish "you lost the claim" from "the DB hiccuped".
    throw new Error(`Failed to renew run lease: ${error.message}`);
  }
  return !!data;
}

/**
 * Mark a run as "completed" — the resumed execution finished successfully.
 *
 * When the caller presents its execution token, the write is fenced: it
 * only lands while that token still owns a live "processing" claim. A
 * stale-marked zombie or a superseded executor gets false and must not
 * treat its result as the record of truth.
 */
export async function markRunCompleted(
  pausedRunId: string,
  userId: string,
  result: RunResult,
  executionToken?: string,
): Promise<boolean> {
  if (!supabaseAdmin) return false;

  const now = new Date().toISOString();
  const update = supabaseAdmin
    .from(TABLE)
    .update({
      run_status: "completed",
      run_result: result,
      run_completed_at: now,
    })
    .eq("id", pausedRunId)
    .eq("user_id", userId);
  if (executionToken) {
    update
      .eq("execution_token", executionToken)
      .eq("run_status", "processing");
  }
  const { data, error } = await update.select("id");
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/**
 * Mark a run as "failed" — the resumed execution threw or returned an error.
 *
 * Same fencing contract as markRunCompleted when a token is presented.
 * Callers without a token (pre-claim failures, internal recovery paths)
 * keep the legacy unconditional write.
 */
export async function markRunFailed(
  pausedRunId: string,
  userId: string,
  error: string,
  executionToken?: string,
): Promise<void> {
  if (!supabaseAdmin) return;

  const now = new Date().toISOString();
  const update = supabaseAdmin
    .from(TABLE)
    .update({
      run_status: "failed",
      run_error: error,
      run_completed_at: now,
    })
    .eq("id", pausedRunId)
    .eq("user_id", userId);
  if (executionToken) {
    update
      .eq("execution_token", executionToken)
      .eq("run_status", "processing");
  }
  await update;
}

export async function expireStaleRuns(): Promise<number> {
  if (!supabaseAdmin) return 0;

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: "expired", resolved_at: now })
    .eq("status", "pending")
    .lt("expires_at", now)
    .select("id");

  if (error) return 0;
  return data?.length ?? 0;
}

export const APPROVAL_TTL = APPROVAL_TTL_MS;

/**
 * Recency rule for transcript reconciliation: a paused-run row can only be
 * the gate for a message that already existed when the row was created.
 *
 * The messages GET reconciler falls back to "the conversation's latest
 * paused run" when no pending run is found. Without a recency bound, a
 * STALE run (e.g. an approval that expired yesterday) is attributed to a
 * FRESH "awaiting_approval" message whenever the pending lookup misses —
 * row persist failure, replication lag, or any lookup mismatch — and the
 * user sees "this approval expired before a decision was made" within
 * seconds of the request. That is the 2026-09-18 production defect.
 *
 * The row is always created after the message it gates (the assistant
 * message is inserted when the stream starts; the pause happens later in
 * the same run), so a run that predates the message cannot be its gate.
 * `toleranceMs` absorbs clock skew between app servers and the DB.
 *
 * When the message timestamp is missing or unparseable we keep the old
 * behavior (attribute the run) rather than risk leaving an approval card
 * mounted forever.
 */
export function pausedRunBelongsToMessage(
  runCreatedAt: string | null | undefined,
  messageCreatedAt: string | null | undefined,
  toleranceMs = 60_000,
): boolean {
  if (!runCreatedAt) return false;
  if (!messageCreatedAt) return true;
  const runAt = Date.parse(runCreatedAt);
  const msgAt = Date.parse(messageCreatedAt);
  if (!Number.isFinite(runAt)) return false;
  if (!Number.isFinite(msgAt)) return true;
  return runAt >= msgAt - toleranceMs;
}

/**
 * Re-request a dead approval gate.
 *
 * An expired approval used to dead-end the run: the transcript said "send
 * the request again", which re-ran the whole agent loop from scratch and
 * lost the frozen tool call the user was asked to approve. Re-requesting
 * creates a FRESH pending run carrying the same frozen inputs/reason, so
 * the user decides on the identical gate with a new TTL — no new agent
 * loop, no duplicate side effects (the gate still needs approval before
 * anything executes).
 *
 * Only an `expired` run can be re-requested. Pending/approved/rejected
 * runs return null (409 to the caller).
 */
export async function reRequestExpiredRun(
  pausedRunId: string,
  userId: string,
): Promise<PausedRunRecord | null> {
  const existing = await getPausedRun(pausedRunId, userId);
  if (!existing || existing.status !== "expired") return null;

  return createPausedRun({
    userId,
    conversationId: existing.conversationId,
    projectId: existing.projectId,
    workspaceId: existing.workspaceId,
    toolId: existing.toolId,
    toolCallId: existing.toolCallId,
    inputs: existing.inputs,
    reason: existing.reason,
    pausedMessages: existing.pausedMessages,
    executionMode: existing.executionMode,
    systemPrompt: existing.systemPrompt,
    checkpointId: existing.checkpointId,
    qualityLoopState: existing.qualityLoopState,
  });
}

/**
 * Reset a failed approved run for a controlled retry.
 *
 * Atomically transitions `status='approved' AND run_status='failed'` back
 * to the not-yet-started state (run_status NULL, errors cleared), so the
 * resume endpoint re-runs the SAME approval record — no new approval, no
 * new billing operation (the shared image service replays on the stable
 * requestId). Step 7's markRunProcessing then claims the execution exactly
 * as it does for a freshly approved run, so a retried run flows through
 * the identical downstream machinery.
 *
 * Returns true when a row was reset; false when the record is not in the
 * approved+failed state (already handled, still processing, or unknown) —
 * the caller must not retry then.
 */
export async function resetRunForRetry(
  pausedRunId: string,
  userId: string,
): Promise<boolean> {
  if (!supabaseAdmin) return false;

  // Lease gate: a failed run whose lease is still fresh may have a live
  // (but fenced, e.g. stall-marked) executor still tearing down — respawning
  // now would run two mutating executors concurrently. A lease can only
  // move toward expiry while failed (the dead executor's renewals are
  // rejected by the run_status guard), so an expired lease is stable proof
  // that nothing is running. Legacy rows have no lease — the old failed
  // state alone is the gate, exactly as before.
  const { data: row, error: readError } = await supabaseAdmin
    .from(TABLE)
    .select("lease_expires_at")
    .eq("id", pausedRunId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError || !row) return false;
  const lease = (row as { lease_expires_at?: string | null }).lease_expires_at;
  if (lease && Date.parse(lease) > Date.now()) return false;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({
      run_status: null,
      run_error: null,
      run_started_at: null,
      run_completed_at: null,
      execution_token: null,
      lease_expires_at: null,
      last_progress_at: null,
    })
    .eq("id", pausedRunId)
    .eq("user_id", userId)
    .eq("status", "approved")
    .eq("run_status", "failed")
    .select("id");

  if (error) return false;
  return (data?.length ?? 0) > 0;
}
