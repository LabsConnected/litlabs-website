"use client";

import type { PendingApproval } from "../stores/useExecutionStore";

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
}

export interface ApprovalRunStatus {
  status: string;
  runStatus: "processing" | "completed" | "failed" | null;
  runResult: ApprovalRunResult | null;
  runError: string | null;
}

export interface ApprovalWatchOutcome {
  /**
   * Final gate state observed on the server:
   * - approved/rejected: a decision was recorded (by any session)
   * - expired: the pause outlived its server-side TTL with no decision
   * - gone: the paused run no longer exists (404) — the card is stale
   */
  status: "approved" | "rejected" | "expired" | "gone";
  runStatus: ApprovalRunStatus["runStatus"];
  runResult: ApprovalRunResult | null;
  runError: string | null;
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
   * same record (no new approval, no double billing).
   */
  onFailed?: (error: string, info?: { retryable: boolean; expired?: boolean }) => void;
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
    onPolling,
    pollIntervalMs = POLL_INTERVAL_MS,
  } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(), ms);
  }));

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
        const retryable = postResp.status >= 500 || postResp.status === 429 || postResp.status === 408;
        onFailed?.(body?.error ?? `Approval failed (${postResp.status})`, { retryable });
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
      // the same record via the server's controlled-retry path.
      if (postBody?.runStatus === "failed") {
        onFailed?.(postBody.runError ?? "Execution failed", { retryable: true });
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

        if (status.runStatus === "completed" && status.runResult) {
          onCompleted?.(status.runResult);
          return;
        }

        if (status.runStatus === "failed") {
          onFailed?.(status.runError ?? "Execution failed", { retryable: true });
          return;
        }

        // The gate itself settled without producing a run — surface the
        // honest state instead of polling into a timeout. Retryable, but
        // as a RE-REQUEST: the gate is gone server-side, so retry must
        // issue a fresh gate via the re-request endpoint rather than
        // re-POST the dead pausedRunId (which would 409).
        if (status.status === "expired") {
          onFailed?.("This approval expired before a decision was made.", { retryable: true, expired: true });
          return;
        }
        if (status.status === "rejected") {
          onFailed?.("This approval was already declined in another session.", { retryable: false });
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
 *   - the paused run is gone (404) → the local card is stale
 * Transient fetch/other failures keep polling until the timeout; a timeout
 * simply stops watching — unknown server state is never reported as settled.
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
        if (status.runStatus === "completed" || status.runStatus === "failed") {
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
  }

  void poll();

  // Return cancel function
  return () => {
    cancelled = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
  };
}
