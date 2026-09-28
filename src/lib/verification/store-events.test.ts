/**
 * PASS 2 mandatory test 13: verification lifecycle events are written through
 * action_events (the canonical ordered event spine). There is deliberately no
 * verification_events table.
 *
 * The InMemoryVerificationStore mirrors the action_events ordering contract
 * (monotonic global sequence); the Supabase store emits via the canonical
 * appendActionEvent. This test proves the event types, ordering, and the
 * action_runs linkage of every emitted event.
 */
import { describe, expect, it } from "vitest";
import { InMemoryVerificationStore } from "./store/memory-store";

const RUN_ID = "8c470510-a6de-4651-a480-588ece7b0663";
const USER_ID = "user_test_13";

describe("verification events ride the action_events spine", () => {
  it("emits the full lifecycle in order, all linked to the action run", async () => {
    const store = new InMemoryVerificationStore();

    const plan = await store.createPlan({ actionRunId: RUN_ID, userId: USER_ID, name: "release-proof" });
    const check = await store.addCheck({
      planId: plan.id,
      actionRunId: RUN_ID,
      userId: USER_ID,
      key: "type-check",
    });
    const attempt = await store.recordAttempt({
      checkId: check.id,
      actionRunId: RUN_ID,
      userId: USER_ID,
      executor: "terminal-executor",
      commandIdentity: "node --version",
    });
    await store.finishAttempt(attempt.id, 0);
    const evRes = await store.recordEvidence({
      actionRunId: RUN_ID,
      checkId: check.id,
      attemptId: attempt.id,
      userId: USER_ID,
      evidenceType: "command_result",
      source: "machine",
      claim: "command 'node --version' succeeded with exit code 0",
      assertions: [{ name: "exit_code_zero", expected: "0", observed: "0", pass: true }],
    });
    // Invalid evidence => quarantine event, not silent.
    await store.recordEvidence({
      actionRunId: RUN_ID,
      checkId: check.id,
      userId: USER_ID,
      evidenceType: "command_result",
      source: "machine",
      claim: "",
      assertions: [],
    });
    await store.recordFailure({
      actionRunId: RUN_ID,
      checkId: check.id,
      userId: USER_ID,
      code: "EXECUTOR_TIMEOUT",
      message: "example durable failure",
    });

    const events = store.getEmittedEvents();
    const types = events.map((e) => e.type);

    // Every lifecycle event type is present, in causal order.
    expect(types).toEqual([
      "verification.plan_created",
      "verification.check_started",
      "verification.attempt_started",
      "verification.evidence_recorded",
      "verification.evidence_quarantined",
      "verification.failed",
    ]);

    // Global sequence is monotonic — the ordering spine contract.
    const sequences = events.map((e) => e.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);

    // Every event is bound to the canonical action run (not a second model).
    for (const e of events) {
      expect(e.runId).toBe(RUN_ID);
      expect(e.userId).toBe(USER_ID);
    }

    // Payloads carry the linkage ids.
    const recorded = events.find((e) => e.type === "verification.evidence_recorded");
    expect(recorded?.payload["evidence_id"]).toBe(evRes.id);
    expect(recorded?.payload["check_id"]).toBe(check.id);
  });

  it("verdict recording emits verification.verdict_changed on the same run", async () => {
    const store = new InMemoryVerificationStore();
    const plan = await store.createPlan({ actionRunId: RUN_ID, userId: USER_ID, name: "p" });
    const check = await store.addCheck({
      planId: plan.id,
      actionRunId: RUN_ID,
      userId: USER_ID,
      key: "k",
    });
    await store.recordVerdict({
      actionRunId: RUN_ID,
      planId: plan.id,
      checkId: check.id,
      userId: USER_ID,
      verdict: {
        verdict: "inconclusive",
        checkVerdicts: [],
        evidenceIds: [],
        policyViolations: [],
        decidedAt: new Date().toISOString(),
      },
    });
    const events = store.getEmittedEvents();
    const verdictEvent = events.find((e) => e.type === "verification.verdict_changed");
    expect(verdictEvent).toBeTruthy();
    expect(verdictEvent?.runId).toBe(RUN_ID);
    expect(verdictEvent?.payload["verdict"]).toBe("inconclusive");
  });
});
