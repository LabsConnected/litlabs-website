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

/**
 * ACC-06a item 3: reasons are no longer length-bounded. The former
 * 200-char bound (MAX_FAILURE_REASON_CHARS) cut reasons
 * mid-sentence; the constant is removed with the bound.
 */

/**
 * A run is created moments before its assistant message placeholder,
 * and a resumed run can finish minutes after the message was created —
 * the pairing window therefore anchors on the message's lifetime
 * (createdAt → updatedAt) with the same 60s tolerance the paused-run
 * pairing uses.
 */
const RUN_MESSAGE_TOLERANCE_MS = 60_000;

export function boundFailureReason(raw: string): string {
  // One line, complete: whitespace is collapsed, the text is never
  // cut (ACC-06a item 3 — a truncated reason misstates what happened).
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Pair each failed assistant message with the failed run that produced
 * it. Returns messageId → complete failure reason. Messages with no
 * matching run (or runs with no recorded reason) are simply absent
 * from the map.
 *
 * No saved identity links a run to its assistant message (the run's
 * idempotency key names the send request, whose clientRequestId is
 * persisted only on the USER message), so pairing is temporal — and
 * the direction matters (Greptile round 2): a failed message can have
 * NO run at all (a credit reservation error fails the send before run
 * creation), so walking messages oldest-first and handing each the
 * oldest run in its window gives a RETRY's reason to that earlier
 * run-less message and leaves the retry bare. Instead, walk runs in
 * chronological order and give each run to the still-unmatched failed
 * message created CLOSEST to it inside the window — a run is created
 * moments before its own message placeholder, so the closest failed
 * message is its owner, never an earlier message that merely shares
 * the tolerance window. Each run and each message is used at most
 * once; a run with no message in its window is dropped rather than
 * mis-attached.
 */
export function failureReasonByMessageId(
  messages: FailureReasonMessage[],
  runs: FailureReasonRun[],
): Map<string, string> {
  const failedMessages = messages.filter(
    (m) => m.role === "assistant" && m.status === "failed",
  );
  const failedRuns = runs
    .filter((r) => r.status === "failed" && r.failureMessage && r.failureMessage.trim().length > 0)
    .slice()
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
    );

  const usedMessageIds = new Set<string>();
  const reasons = new Map<string, string>();
  for (const run of failedRuns) {
    const runAt = Date.parse(run.createdAt);
    if (!Number.isFinite(runAt)) continue;
    let best: FailureReasonMessage | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    let bestStart = Number.NEGATIVE_INFINITY;
    for (const message of failedMessages) {
      if (usedMessageIds.has(message.id)) continue;
      const msgStart = Date.parse(message.createdAt);
      const msgEnd = Date.parse(message.updatedAt ?? message.createdAt);
      if (Number.isFinite(msgStart) && runAt < msgStart - RUN_MESSAGE_TOLERANCE_MS) continue;
      if (Number.isFinite(msgEnd) && runAt > msgEnd + RUN_MESSAGE_TOLERANCE_MS) continue;
      const delta = Number.isFinite(msgStart) ? Math.abs(msgStart - runAt) : 0;
      // Closest creation time wins; an exact tie goes to the later
      // message, then to the higher id, so pairing is deterministic.
      if (
        delta < bestDelta ||
        (delta === bestDelta &&
          (msgStart > bestStart || (msgStart === bestStart && best !== null && message.id > best.id)))
      ) {
        best = message;
        bestDelta = delta;
        bestStart = msgStart;
      }
    }
    if (best) {
      usedMessageIds.add(best.id);
      reasons.set(best.id, boundFailureReason(run.failureMessage as string));
    }
  }
  return reasons;
}
