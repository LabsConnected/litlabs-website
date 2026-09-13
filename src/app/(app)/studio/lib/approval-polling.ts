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
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

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
  onFailed?: (error: string) => void;
  onPolling?: () => void;
}): () => void {
  let cancelled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const { conversationId, pausedRunId, decision, onAccepted, onCompleted, onFailed, onPolling } = opts;

  async function run() {
    try {
      // 1. POST the approval
      const postResp = await fetch(
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
        onFailed?.(body?.error ?? `Approval failed (${postResp.status})`);
        return;
      }

      const postBody = await postResp.json().catch(() => null) as {
        status?: string;
        runStatus?: string;
        runError?: string;
        resolved?: boolean;
        runResult?: ApprovalRunResult;
      } | null;

      // For rejected approvals, no polling needed
      if (decision === "rejected" || postBody?.status === "completed") {
        onAccepted?.();
        if (postBody?.runResult) {
          onCompleted?.(postBody.runResult as ApprovalRunResult);
        }
        return;
      }

      // Approval accepted — notify caller
      onAccepted?.();

      // Check if already completed/failed in the POST response
      if (postBody?.runStatus === "completed" && postBody) {
        // Need to GET the full result
      } else if (postBody?.runStatus === "failed") {
        onFailed?.(postBody.runError ?? "Execution failed");
        return;
      }

      // 2. Poll GET for run status
      onPolling?.();
      const deadline = Date.now() + POLL_TIMEOUT_MS;

      while (!cancelled && Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          timeoutHandle = setTimeout(() => resolve(), POLL_INTERVAL_MS);
        });
        if (cancelled) return;

        const getResp = await fetch(
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
          onFailed?.(status.runError ?? "Execution failed");
          return;
        }
        // Still processing — continue polling
      }

      if (!cancelled) {
        onFailed?.("Deployment timed out — please check the project status and try again.");
      }
    } catch (err) {
      if (!cancelled) {
        onFailed?.(err instanceof Error ? err.message : "Approval request failed");
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
