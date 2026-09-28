/**
 * PASS 2 mandatory integration test — the full truth loop against a real
 * persistence boundary:
 *
 *   real terminal command
 *     -> verification attempt created
 *     -> command executed
 *     -> output sanitized/redacted
 *     -> evidence persisted
 *     -> artifact persisted (stdout) with sha256
 *     -> verification action_event appended
 *     -> data RELOADED from persistence (deep-cloned; no live references)
 *     -> verdict engine evaluates ONLY the reloaded data
 *     -> deterministic verdict returned
 *
 * CRITICAL: the verdict engine never sees the in-memory executor result.
 * Everything it evaluates comes back through the store's reload path.
 */
import { describe, expect, it } from "vitest";
import { InMemoryVerificationStore } from "./store/memory-store";
import {
  commandResultToEvidenceDraft,
  executeCommand,
} from "./executors/terminal-executor";
import { decidePlan } from "./verdict/decide-plan";
import { defaultPolicy } from "./policy";
import { containsSecretLike } from "./redaction";

const RUN_ID = "25f66886-df84-421b-9141-d62370cb1dc1";
const USER_ID = "user_integration";

describe("verification integration: terminal command to deterministic verdict", () => {
  it("runs the full loop and returns a deterministic PASS from reloaded data", async () => {
    const store = new InMemoryVerificationStore();
    const nowIso = new Date().toISOString();

    // 1. Plan + required check.
    const plan = await store.createPlan({
      actionRunId: RUN_ID,
      userId: USER_ID,
      name: "integration-proof",
    });
    const check = await store.addCheck({
      planId: plan.id,
      actionRunId: RUN_ID,
      userId: USER_ID,
      key: "node-version-smoke",
      required: true,
    });
    await store.snapshotPolicy(plan.id, RUN_ID, USER_ID, defaultPolicy());

    // 2. Attempt created BEFORE execution.
    const attempt = await store.recordAttempt({
      checkId: check.id,
      actionRunId: RUN_ID,
      userId: USER_ID,
      executor: "terminal-executor",
      commandIdentity: "node --version",
    });

    // 3. REAL terminal command executes.
    const result = executeCommand({
      identity: "node --version",
      executorId: "terminal-executor",
      command: "node",
      args: ["--version"],
      timeoutMs: 30_000,
    });
    expect(result.exitCode).toBe(0);
    await store.finishAttempt(attempt.id, result.exitCode);

    // 4. Evidence draft from the result (redacted by the executor).
    const draft = commandResultToEvidenceDraft(result);
    expect(containsSecretLike(draft.payload)).toBe(false);

    // 5. Artifact persisted (redacted stdout) with its sha256.
    const artifact = await store.storeArtifact({
      sha256: draft.stdoutArtifact.sha256,
      byteSize: draft.stdoutArtifact.byteSize,
      contentType: "text/plain",
      storageRef: `memory://artifacts/${draft.stdoutArtifact.sha256}`,
    });

    // 6. Evidence persisted (store redacts again + validates schema).
    const evRes = await store.recordEvidence({
      actionRunId: RUN_ID,
      checkId: check.id,
      attemptId: attempt.id,
      userId: USER_ID,
      evidenceType: draft.evidenceType,
      source: "machine",
      claim: draft.claim,
      assertions: draft.assertions,
      payload: draft.payload,
      integrity: draft.integrity,
    });
    expect(evRes.quarantined).toBe(false);
    await store.linkArtifact(evRes.id as string, artifact.id);

    // 7. DROP every live reference. Reload from the persistence boundary.
    const reloaded = await store.getPlanState(plan.id);
    expect(reloaded.evidence).toHaveLength(1);
    expect(reloaded.artifacts).toHaveLength(1);
    expect(reloaded.artifactLinks).toHaveLength(1);

    // 8. Verdict engine evaluates ONLY reloaded data — twice.
    const decideFromReloaded = () =>
      decidePlan({
        checks: reloaded.checks,
        evidence: reloaded.evidence,
        quarantinedEvidenceIds: reloaded.quarantine
          .map((q) => q.evidenceId)
          .filter((id): id is string => id !== null),
        failures: reloaded.failures,
        policy: reloaded.policy ?? defaultPolicy(),
        checkpointFacts: {},
        nowIso,
      });
    const first = decideFromReloaded();
    const second = decideFromReloaded();

    expect(first.verdict).toBe("pass");
    expect(second).toEqual(first);
    expect(first.evidenceIds).toEqual([evRes.id]);

    // 9. The verdict itself is persisted as a derived record.
    const verdictRecord = await store.recordVerdict({
      actionRunId: RUN_ID,
      planId: plan.id,
      userId: USER_ID,
      verdict: first,
    });
    expect(verdictRecord.verdict).toBe("pass");

    // 10. The action_event spine carries the whole lifecycle.
    const types = store.getEmittedEvents().map((e) => e.type);
    expect(types).toEqual([
      "verification.plan_created",
      "verification.check_started",
      "verification.policy_snapshot",
      "verification.attempt_started",
      "verification.evidence_recorded",
      "verification.verdict_changed",
    ]);
  });

  it("a failing command yields FAIL from reloaded data", async () => {
    const store = new InMemoryVerificationStore();
    const nowIso = new Date().toISOString();
    const plan = await store.createPlan({ actionRunId: RUN_ID, userId: USER_ID, name: "p" });
    const check = await store.addCheck({
      planId: plan.id,
      actionRunId: RUN_ID,
      userId: USER_ID,
      key: "failing-smoke",
      required: true,
    });
    const attempt = await store.recordAttempt({
      checkId: check.id,
      actionRunId: RUN_ID,
      userId: USER_ID,
      executor: "terminal-executor",
      commandIdentity: "node -e exit 1",
    });
    const result = executeCommand({
      identity: "node -e exit 1",
      executorId: "terminal-executor",
      command: "node",
      args: ["-e", "process.exit(1)"],
      timeoutMs: 30_000,
    });
    expect(result.exitCode).toBe(1);
    await store.finishAttempt(attempt.id, result.exitCode);
    const draft = commandResultToEvidenceDraft(result);
    await store.recordEvidence({
      actionRunId: RUN_ID,
      checkId: check.id,
      attemptId: attempt.id,
      userId: USER_ID,
      evidenceType: draft.evidenceType,
      source: "machine",
      claim: draft.claim,
      assertions: draft.assertions,
      payload: draft.payload,
      integrity: draft.integrity,
    });

    const reloaded = await store.getPlanState(plan.id);
    const verdict = decidePlan({
      checks: reloaded.checks,
      evidence: reloaded.evidence,
      quarantinedEvidenceIds: [],
      failures: reloaded.failures,
      policy: defaultPolicy(),
      checkpointFacts: {},
      nowIso,
    });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.checkVerdicts[0].reasons).toContain("assertion_failed:exit_code_zero");
  });
});
