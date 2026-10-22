"use client";

import type { PendingApproval } from "../stores/useExecutionStore";
import type { WorkspaceChangeEvidence } from "@/lib/studio/completion-evidence";

/**
 * Polling interval for approval run status (ms).
 * Fast enough for good UX, slow enough to avoid hammering the server.
 */
const POLL_INTERVAL_MS = 3000;

/**
 * Maximum time to poll before giving up (ms).
 * 10 minutes — matches the server-side stale-run timeout.
 */
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

export interface ApprovalRunResult {
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
   * The settled run's workspace-change verdict (R3 / E4-S5), carried
   * verbatim from the server record (RunResult.workspaceChange) so the
   * outcome a user sees can state what actually happened to the files —
   * including for runs interrupted before their finalize tail, whose
   * verdicts are computed at settle time server-side. Mirrors the
   * fresh-run shape (MessageExecution.workspaceChange); not a new form.
   */
  workspaceChange?: WorkspaceChangeEvidence | null;
}

export interface ApprovalRunStatus {
  status: string;
  /**
   * The run's derived outcome. "cancelled" is distinct from "failed"
   * (R4/E3-S2): a stopped run must settle as a cancellation on every
   * surface, never as a failure and never as silence.
   */
  runStatus: "processing" | "completed" | "failed" | "cancelled" | null;
  runResult: ApprovalRunResult | null;
  runError: string | null;
  /**
   * The run's LIVE nested gate, named at top level by the approvals GET
   * (R4/E1-F3): the resumed segment re-paused at a DIFFERENT paused run.
   * Either poll loop hands off to it promptly instead of parking in
   * "executing" until the poll timeout while the server waits.
   */
  pendingApproval?: {
    toolId: string;
    pausedRunId?: string;
    reason: string;
  } | null;
}

export interface ApprovalWatchOutcome {
  /**
   * Final gate state observed on the server:
   * - approved/rejected: a decision was recorded (by any session)
   * - expired: the pause outlived its server-side TTL with no decision
   * - gone: the paused run no longer exists (404) — the card is stale
   * - timeout: the watch window elapsed with the run unsettled
   *   (R4/E3-S2 — a delivered outcome, never a silent exit)
   */
  status: "approved" | "rejected" | "expired" | "gone" | "timeout";
  runStatus: ApprovalRunStatus["runStatus"];
  runResult: ApprovalRunResult | null;
  runError: string | null;
  /** Set when the watch settled because the run re-paused at a new gate. */
  pendingApproval?: ApprovalRunResult["pendingApproval"];
}

/**
 * Submit an approval decision and poll for the resumed execution result.
 *
 * This handles the async approval contract:
 * 1. POST the approval — returns 202 immediately
 * 2. Poll GET until runStatus is "completed" or "failed"
 * 3. Call onCompleted or onFailed with the result
 *
 * Idempotent: if the approval was already submitted, the POST returns 202
 * with the current run status, and polling continues from there.
 *
 * @returns A cancel function to stop polling (for component teardown).
 */
export function submitApprovalAndPoll(opts: {
  conversationId: string;
  pausedRunId: string;
  decision: "approved" | "rejected";
  onAccepted?: () => void;
  onCompleted?: (result: ApprovalRunResult) => void;
  /**
   * Called with the backend error when the approval POST is rejected
   * (non-2xx) or the resumed run fails. `info.retryable` says whether
   * re-POSTing the same pausedRunId is meaningful — the server re-runs the
   * same record (no new approval, no double billing). `info.decisionRecorded`
   * says whether the decision reached the server: false means the POST never
   * landed, so the gate is still pending and actionable; true means the run
   * executed and failed, so the gate is dead.
   */
  onFailed?: (error: string, info?: { retryable: boolean; expired?: boolean; decisionRecorded?: boolean }) => void;
  /**
   * The run settled CANCELLED (R4/E3-S2) — a terminal outcome distinct
   * from failure: the gate is dead, the mission hint clears, and no
   * failure/retry card is fabricated for a run the record says stopped.
   * When omitted, a cancellation degrades to onFailed with
   * decisionRecorded: true (the gate still clears; the phase records
   * "failed" — callers should wire onCancelled).
   */
  onCancelled?: (result: ApprovalRunResult | null, reason?: string) => void;
  onPolling?: () => void;
  /** Test hooks — production callers use the real fetch/timers. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
}): () => void {
  let cancelled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const {
    conversationId,
    pausedRunId,
    decision,
    onAccepted,
    onCompleted,
    onFailed,
    onCancelled,
    onPolling,
    pollIntervalMs = POLL_INTERVAL_MS,
  } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(), ms);
  }));

  /**
   * A NEW gate for a DIFFERENT paused run, named by a poll response —
   * either nested in the RunResult (the settled segment's handoff) or at
   * top level on the GET body (the run's live sibling gate, R4/E1-F3).
   * The gate THIS poll is bound to is never a re-pause.
   */
  function rePauseGateFrom(status: ApprovalRunStatus): ApprovalRunResult["pendingApproval"] | null {
    const nested = status.runResult?.pendingApproval;
    if (nested?.pausedRunId && nested.pausedRunId !== pausedRunId) return nested;
    const top = status.pendingApproval;
    if (top?.pausedRunId && top.pausedRunId !== pausedRunId) return top;
    return null;
  }

  /** Settle a cancelled run through the distinct cancelled outcome. */
  function settleCancelled(result: ApprovalRunResult | null, reason?: string) {
    if (onCancelled) {
      onCancelled(result, reason ?? result?.cancelReason);
    } else {
      onFailed?.(reason ?? result?.cancelReason ?? "The run was cancelled.", {
        retryable: false,
        decisionRecorded: true,
      });
    }
  }

  async function run() {
    try {
      // 1. POST the approval
      const postResp = await fetchImpl(
        `/api/studio/conversations/${conversationId}/approvals/${pausedRunId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );

      if (cancelled) return;

      if (!postResp.ok && postResp.status !== 202 && postResp.status !== 409) {
        const body = await postResp.json().catch(() => null) as { error?: string } | null;
        // 5xx/429/408 may succeed on retry (the POST is idempotent);
        // other 4xx will not — surface the error without a retry affordance.
        // The decision never landed server-side, so the gate is still
        // pending and actionable — the card must stay, not silently clear.
        const retryable = postResp.status >= 500 || postResp.status === 429 || postResp.status === 408;
        onFailed?.(body?.error ?? `Approval failed (${postResp.status})`, { retryable, decisionRecorded: false });
        return;
      }

      const postBody = await postResp.json().catch(() => null) as {
        status?: string;
        runStatus?: string;
        runError?: string;
        resolved?: boolean;
        runResult?: ApprovalRunResult;
      } | null;

      // For rejected approvals nothing runs server-side — settle now.
      // (An APPROVED decision that lands on an already-completed detached
      // run must NOT return here: the POST carries no runResult, so the
      // outcome still has to be pulled via GET below.)
      if (decision === "rejected") {
        onAccepted?.();
        return;
      }

      // Approval accepted — notify caller
      onAccepted?.();

      // A failure already recorded on the paused run is terminal for this
      // attempt — but retryable: re-POSTing the same pausedRunId re-runs
      // the same record via the server's controlled-retry path. The decision
      // was recorded, so the gate itself is dead even when a retry is
      // offered: the card must not keep Approve/Reject actionable.
      if (postBody?.runStatus === "failed") {
        onFailed?.(postBody.runError ?? "Execution failed", { retryable: true, decisionRecorded: true });
        return;
      }

      // A cancellation already recorded on the paused run is terminal
      // too — and it is a CANCELLATION (R4/E3-S2), never a failure.
      if (postBody?.runStatus === "cancelled") {
        settleCancelled(postBody.runResult ?? null, postBody.runError ?? undefined);
        return;
      }

      // 2. Poll GET for run status
      onPolling?.();
      const deadline = Date.now() + POLL_TIMEOUT_MS;

      while (!cancelled && Date.now() < deadline) {
        await sleep(pollIntervalMs);
        if (cancelled) return;

        const getResp = await fetchImpl(
          `/api/studio/conversations/${conversationId}/approvals/${pausedRunId}`,
        ).catch(() => null);

        if (!getResp || !getResp.ok) continue;

        const status = await getResp.json().catch(() => null) as ApprovalRunStatus | null;
        if (!status) continue;

        // Nested re-pause handoff FIRST (R4/E1-F3): the resumed segment
        // paused again at a NEW gate — the server is waiting on the user
        // NOW. Hand the UI the new gate promptly; never keep polling
        // this gate into the 15-minute timeout. (A re-gate whose own
        // segment already settled reads runStatus "completed" with the
        // handoff nested in its RunResult — the same check catches it,
        // before the plain-completed branch below can drop the gate.)
        const rePause = rePauseGateFrom(status);
        if (rePause) {
          onCompleted?.(status.runResult ?? {
            finalText: "",
            stepsUsed: 0,
            toolCalls: [],
            cancelled: false,
            pendingApproval: rePause,
          });
          return;
        }

        if (status.runStatus === "completed" && status.runResult) {
          onCompleted?.(status.runResult);
          return;
        }

        if (status.runStatus === "cancelled") {
          // A stopped run settles as a CANCELLATION (R4/E3-S2) — not a
          // failure, not a timeout. The gate is dead; the record's own
          // reason rides along.
          settleCancelled(status.runResult, status.runError ?? undefined);
          return;
        }

        if (status.runStatus === "failed") {
          // The resumed run executed and failed — the decision was recorded,
          // so the gate is dead. Retry replays the identical frozen run and
          // is only meaningful for transient failures; the store decides
          // whether the gate stays actionable.
          onFailed?.(status.runError ?? "Execution failed", { retryable: true, decisionRecorded: true });
          return;
        }

        // The gate itself settled without producing a run — surface the
        // honest state instead of polling into a timeout. Retryable, but
        // as a RE-REQUEST: the gate is gone server-side, so retry must
        // issue a fresh gate via the re-request endpoint rather than
        // re-POST the dead pausedRunId (which would 409).
        if (status.status === "expired") {
          onFailed?.("This approval expired before a decision was made.", { retryable: true, expired: true, decisionRecorded: false });
          return;
        }
        if (status.status === "rejected") {
          // Decided elsewhere — the local gate is dead, not pending.
          onFailed?.("This approval was already declined in another session.", { retryable: false, decisionRecorded: true });
          return;
        }
        // Still processing — continue polling
      }

      if (!cancelled) {
        onFailed?.("Approval timed out — please check the project status and try again.", { retryable: true });
      }
    } catch (err) {
      if (!cancelled) {
        onFailed?.(err instanceof Error ? err.message : "Approval request failed", { retryable: true });
      }
    }
  }

  void run();

  // Return cancel function
  return () => {
    cancelled = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
  };
}

/**
 * Watch a paused run's server-authoritative status until its approval gate
 * settles — decided (approved/rejected), expired, gone, or the resumed
 * execution reaches a terminal runStatus. READ-ONLY: never submits a
 * decision, so it is safe to run while the gate is still pending.
 *
 * This covers resolutions the local client did not initiate — a decision
 * made in another session/device, a page reload while the resumed run was
 * still executing, or a pause expiring server-side — where the local
 * pendingApproval card would otherwise stay mounted with no path to
 * converge.
 *
 * Settles (stops polling and calls onSettled) when:
 *   - status is "rejected" | "expired" → the decision is final, nothing is running
 *   - runStatus is "completed" | "failed" → the resumed execution finished
 *   - runStatus is "cancelled" → the run stopped (R4/E3-S2: a distinct outcome)
 *   - the run re-paused at a NEW gate → hand the UI the new gate (R4/E1-F3)
 *   - the paused run is gone (404) → the local card is stale
 * Transient fetch/other failures keep polling until the timeout. A timeout
 * now DELIVERS a "timeout" outcome (R4/E3-S2): the UI must be told the
 * run's state could not be confirmed — exiting silently made "unknown"
 * indistinguishable from "still running" and stranded the gate forever.
 *
 * @returns A cancel function to stop watching (for component teardown).
 */
export function watchApprovalResolution(opts: {
  conversationId: string;
  pausedRunId: string;
  onSettled?: (outcome: ApprovalWatchOutcome) => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetchStatus?: () => Promise<ApprovalRunStatus | "gone" | null>;
  sleep?: (ms: number) => Promise<void>;
}): () => void {
  let cancelled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const {
    conversationId,
    pausedRunId,
    onSettled,
    pollIntervalMs = POLL_INTERVAL_MS,
    timeoutMs = POLL_TIMEOUT_MS,
    sleep = (ms: number) => new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(), ms);
    }),
  } = opts;

  const fetchStatus = opts.fetchStatus ?? (async () => {
    const resp = await fetch(
      `/api/studio/conversations/${conversationId}/approvals/${pausedRunId}`,
      { credentials: "include" },
    ).catch(() => null);
    if (!resp) return null;
    if (resp.status === 404) return "gone";
    if (!resp.ok) return null;
    return (await resp.json().catch(() => null)) as ApprovalRunStatus | null;
  });

  async function poll() {
    const deadline = Date.now() + timeoutMs;
    while (!cancelled && Date.now() < deadline) {
      const status = await fetchStatus().catch(() => null);
      if (cancelled) return;

      if (status === "gone") {
        onSettled?.({ status: "gone", runStatus: null, runResult: null, runError: null });
        return;
      }
      if (status) {
        if (status.status === "rejected" || status.status === "expired") {
          onSettled?.({
            status: status.status,
            runStatus: status.runStatus,
            runResult: status.runResult,
            runError: status.runError,
          });
          return;
        }
        // Nested re-pause (R4/E1-F3): the resumed segment paused again
        // at a NEW gate — settle now and hand the UI the new gate,
        // instead of watching this gate while the server waits on the
        // user at the next one.
        const nested = status.runResult?.pendingApproval;
        const topLevel = status.pendingApproval;
        const rePause =
          nested?.pausedRunId && nested.pausedRunId !== pausedRunId
            ? nested
            : topLevel?.pausedRunId && topLevel.pausedRunId !== pausedRunId
              ? topLevel
              : null;
        if (rePause) {
          onSettled?.({
            status: "approved",
            runStatus: "completed",
            runResult: status.runResult ?? {
              finalText: "",
              stepsUsed: 0,
              toolCalls: [],
              cancelled: false,
              pendingApproval: rePause,
            },
            runError: status.runError,
            pendingApproval: rePause,
          });
          return;
        }
        if (
          status.runStatus === "completed" ||
          status.runStatus === "failed" ||
          status.runStatus === "cancelled"
        ) {
          // A cancelled run settles as "cancelled" (R4/E3-S2) — the
          // caller converges the gate as a stop, never as a failure.
          onSettled?.({
            status: "approved",
            runStatus: status.runStatus,
            runResult: status.runResult,
            runError: status.runError,
          });
          return;
        }
        // "pending" (no decision yet) or "approved" + "processing" — keep watching
      }
      await sleep(pollIntervalMs);
    }
    // Watch window elapsed with the run unsettled: deliver the timeout
    // outcome instead of exiting silently (R4/E3-S2).
    if (!cancelled) {
      onSettled?.({ status: "timeout", runStatus: null, runResult: null, runError: null });
    }
  }

  void poll();

  // Return cancel function
  return () => {
    cancelled = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
  };
}
