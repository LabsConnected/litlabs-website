/**
 * Failure-reason read-back for the Studio transcript (PR #1114
 * Greptile thread 2).
 *
 * ACC-05 item 1 put the failed run's primary failure reason on the
 * live send's done event only. Message storage carries no execution
 * record, so a reload lost the reason — and a run that failed after an
 * approval resume never had one on the client at all, because approval
 * completion reloads messages without the resumed result.
 *
 * The durable record that DOES hold the reason is the action run:
 * both settle paths (initial send, approval resume) write the primary
 * failure reason as the run's `failureMessage`. This module pairs
 * those records back onto the failed assistant messages they produced
 * so the messages GET can re-attach the reason on every load. The
 * reason is work-log data only — the chat bubble keeps its plain
 * "We hit a snag, try again." text.
 */

export interface FailureReasonMessage {
  id: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt?: string | null;
}

export interface FailureReasonRun {
  id: string;
  status: string;
  failureMessage: string | null;
  createdAt: string;
}

/** Same bound item 1 established for the live reason: one line, ≤200 chars. */
export const MAX_FAILURE_REASON_CHARS = 200;

/**
 * A run is created moments before its assistant message placeholder,
 * and a resumed run can finish minutes after the message was created —
 * the pairing window therefore anchors on the message's lifetime
 * (createdAt → updatedAt) with the same 60s tolerance the paused-run
 * pairing uses.
 */
const RUN_MESSAGE_TOLERANCE_MS = 60_000;

export function boundFailureReason(raw: string): string {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_FAILURE_REASON_CHARS
    ? oneLine.slice(0, MAX_FAILURE_REASON_CHARS)
    : oneLine;
}

/**
 * Pair each failed assistant message with the failed run that produced
 * it, oldest first, each run used at most once. Returns messageId →
 * bounded failure reason. Messages with no matching run (or runs with
 * no recorded reason) are simply absent from the map.
 */
export function failureReasonByMessageId(
  messages: FailureReasonMessage[],
  runs: FailureReasonRun[],
): Map<string, string> {
  const failedMessages = messages
    .filter((m) => m.role === "assistant" && m.status === "failed")
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const failedRuns = runs
    .filter((r) => r.status === "failed" && r.failureMessage && r.failureMessage.trim().length > 0)
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const usedRunIds = new Set<string>();
  const reasons = new Map<string, string>();
  for (const message of failedMessages) {
    const msgStart = Date.parse(message.createdAt);
    const msgEnd = Date.parse(message.updatedAt ?? message.createdAt);
    const run = failedRuns.find((candidate) => {
      if (usedRunIds.has(candidate.id)) return false;
      const runAt = Date.parse(candidate.createdAt);
      if (!Number.isFinite(runAt)) return false;
      if (Number.isFinite(msgStart) && runAt < msgStart - RUN_MESSAGE_TOLERANCE_MS) return false;
      if (Number.isFinite(msgEnd) && runAt > msgEnd + RUN_MESSAGE_TOLERANCE_MS) return false;
      return true;
    });
    if (run) {
      usedRunIds.add(run.id);
      reasons.set(message.id, boundFailureReason(run.failureMessage as string));
    }
  }
  return reasons;
}
