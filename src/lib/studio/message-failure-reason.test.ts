import { describe, expect, it } from "vitest";

import { boundFailureReason, failureReasonByMessageId } from "./message-failure-reason";

/**
 * PR #1114 Greptile thread 2 — failure reasons must survive a reload.
 *
 * The live send's done event carries the failure reason, but a reload
 * rebuilds the transcript from stored messages, which carry no
 * execution data. The durable record that DOES hold the reason is the
 * action run's failureMessage (written at settle on both the initial
 * send path and the approval-resume path). These tests pin the
 * read-back pairing: each failed assistant message gets the reason of
 * the failed run that produced it.
 */

const T0 = "2026-11-24T19:10:00.000Z";
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

function failedMessage(id: string, createdSeconds: number, updatedSeconds = createdSeconds + 30) {
  return {
    id,
    role: "assistant" as const,
    status: "failed",
    createdAt: at(createdSeconds),
    updatedAt: at(updatedSeconds),
  };
}

function failedRun(id: string, createdSeconds: number, failureMessage: string | null) {
  return { id, status: "failed", failureMessage, createdAt: at(createdSeconds) };
}

describe("failureReasonByMessageId", () => {
  it("pairs a failed run's reason with the failed message it produced (initial-send shape)", () => {
    const reasons = failureReasonByMessageId(
      [
        { id: "u1", role: "user", status: "completed", createdAt: at(0), updatedAt: at(0) },
        failedMessage("a1", 2),
      ],
      [failedRun("run-1", 1, "files.write: workspace transport unavailable")],
    );
    expect(reasons.get("a1")).toBe("files.write: workspace transport unavailable");
  });

  it("pairs a resume-path failure's contributor reason the same way", () => {
    // Approval-resume failures settle onto the SAME action run record,
    // with the primary contributor reason as its failureMessage.
    const reasons = failureReasonByMessageId(
      [failedMessage("a1", 2, 400)],
      [failedRun("run-1", 1, "image.generate: Bad input: width not allowed")],
    );
    expect(reasons.get("a1")).toBe("image.generate: Bad input: width not allowed");
  });

  it("gives a retry's reason to the retry message, not the earlier run-less failure (Greptile round 2)", () => {
    // Greptile's exact scenario: message A failed on a credit
    // reservation error BEFORE any action run existed, so no run
    // carries its failure. The user retries ~30s later; the retry's
    // run fails with a recorded reason. Oldest-first pairing handed
    // the retry's reason to A (its lifetime window still contains the
    // retry run's timestamp) and left the retry message bare.
    const reasons = failureReasonByMessageId(
      [failedMessage("a1", 2, 10), failedMessage("a2", 40, 75)],
      [failedRun("run-retry", 39, "files.write: workspace transport unavailable")],
    );
    expect(reasons.get("a2")).toBe("files.write: workspace transport unavailable");
    expect(reasons.has("a1")).toBe(false);
    expect(reasons.size).toBe(1);
  });

  it("does not cross reasons when a retry follows a real failure inside the window", () => {
    // Both messages have runs; the retry was sent within the first
    // message's tolerance window. Each run's reason must stay with
    // the message created closest to that run.
    const reasons = failureReasonByMessageId(
      [failedMessage("a1", 2, 32), failedMessage("a2", 40, 75)],
      [
        failedRun("run-1", 1, "first failure reason"),
        failedRun("run-2", 39, "retry failure reason"),
      ],
    );
    expect(reasons.get("a1")).toBe("first failure reason");
    expect(reasons.get("a2")).toBe("retry failure reason");
    expect(reasons.size).toBe(2);
  });

  it("pairs two failures in order without crossing reasons", () => {
    const reasons = failureReasonByMessageId(
      [failedMessage("a1", 2), failedMessage("a2", 200)],
      [
        failedRun("run-1", 1, "first failure reason"),
        failedRun("run-2", 199, "second failure reason"),
      ],
    );
    expect(reasons.get("a1")).toBe("first failure reason");
    expect(reasons.get("a2")).toBe("second failure reason");
    expect(reasons.size).toBe(2);
  });

  it("never attaches a completed run, an empty reason, or a reason to a non-failed message", () => {
    const reasons = failureReasonByMessageId(
      [
        failedMessage("a1", 2),
        { id: "a2", role: "assistant", status: "completed", createdAt: at(200), updatedAt: at(230) },
      ],
      [
        { id: "run-ok", status: "completed", failureMessage: "not a failure", createdAt: at(1) },
        failedRun("run-empty", 199, "   "),
      ],
    );
    expect(reasons.size).toBe(0);
  });

  it("does not pair a run that ended long before the message existed", () => {
    const reasons = failureReasonByMessageId(
      [failedMessage("a1", 3600)],
      [failedRun("run-old", 1, "stale reason from an earlier turn")],
    );
    expect(reasons.size).toBe(0);
  });

  it("bounds the attached reason to one sanitized line of at most 200 chars", () => {
    const long = `files.write: ${"x".repeat(400)}\nsecond line`;
    const reasons = failureReasonByMessageId([failedMessage("a1", 2)], [failedRun("run-1", 1, long)]);
    const reason = reasons.get("a1");
    expect(reason).toBeDefined();
    expect(reason!.length).toBeLessThanOrEqual(200);
    expect(reason).not.toContain("\n");
  });
});

describe("boundFailureReason", () => {
  it("collapses whitespace and truncates to 200 chars", () => {
    expect(boundFailureReason("  a\n\n b\t c  ")).toBe("a b c");
    expect(boundFailureReason("y".repeat(250))).toHaveLength(200);
  });
});
