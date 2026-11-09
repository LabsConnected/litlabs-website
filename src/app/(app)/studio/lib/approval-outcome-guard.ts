/**
 * Single-flight guard for approval outcomes (approval-loop §6.3).
 *
 * The approval poller (submitApprovalAndPoll) and the approval watcher
 * (useApprovalWatcher) both observe the same paused-run outcome. When
 * the run resumes into a NESTED gate, the second observer's
 * applyApprovalOutcome call finds the NEW gate mounted as
 * pendingApproval — and resolveApproval("approved") appends a second
 * "Approved" entry for a gate nobody clicked. The first observer's
 * call is the legitimate one; the second is a no-op.
 *
 * Only gate-RESOLVING outcomes are single-flight. A failed outcome
 * (runError set — the POST never landed or the resumed run failed
 * server-side) must stay retryable: the retry re-issues the SAME
 * pausedRunId, and its later successful completion must still apply.
 * "expired"/"gone" outcomes never resolve a gate, so they are not
 * tracked either.
 */
export type ApprovalOutcomeResolution = "approved" | "rejected" | "expired" | "gone";

export interface ApprovalOutcomeGuardInput {
  resolution: ApprovalOutcomeResolution;
  runError?: string | null;
}

export interface ApprovalOutcomeGuard {
  shouldProcess(pausedRunId: string | undefined, input: ApprovalOutcomeGuardInput): boolean;
}

export function createApprovalOutcomeGuard(maxTracked = 50): ApprovalOutcomeGuard {
  const processed = new Set<string>();
  return {
    shouldProcess(pausedRunId, input) {
      if (!pausedRunId) return true;
      if (input.runError) return true;
      if (input.resolution !== "approved" && input.resolution !== "rejected") return true;
      if (processed.has(pausedRunId)) return false;
      processed.add(pausedRunId);
      // Bound the set: a long session accumulates decided gates.
      if (processed.size > maxTracked) {
        const oldest = processed.values().next().value;
        if (oldest !== undefined) processed.delete(oldest);
      }
      return true;
    },
  };
}
