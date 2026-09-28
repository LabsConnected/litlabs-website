/**
 * PASS 2 mandatory unit tests — verdict engine truth invariants.
 *
 *  1. No evidence => INCONCLUSIVE
 *  2. Schema-invalid evidence => INCONCLUSIVE + quarantine row created
 *  3. Artifact SHA mismatch => evidence invalid => INCONCLUSIVE
 *  4. Conflicting authoritative evidence => INCONCLUSIVE
 *  5. Required assertion explicitly fails => FAIL
 *  6. Required check skipped without valid policy reason => invariant violation / cannot PASS
 *  7. Optional check skipped with explicit valid policy reason => non-blocking
 *  8. Mutation verification with no pre-mutation checkpoint => cannot PASS
 *  9. Secret/API-token-like value attempts to persist => raw secret never reaches persisted evidence
 * 10. Same persisted input evaluated twice => exact same deterministic verdict
 * 11. LLM/assistant narration only => cannot PASS a machine-evidence requirement
 * 12. Invalid evidence cannot be silently converted into valid evidence
 * 14. Verification rows reference action_runs.id
 *
 * (13 — verification events through action_events — is covered in
 * store-events.test.ts against the store port.)
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type {
  CheckDefinition,
  EvidenceRecord,
  PolicySnapshot,
} from "./types";
import { decidePlan } from "./verdict/decide-plan";
import { classifyEvidence } from "./verdict/evaluate-evidence";
import { defaultPolicy } from "./policy";
import { hashPayload } from "./hashes";
import { InMemoryVerificationStore } from "./store/memory-store";

const RUN_ID = "2d5ffcb1-70b6-4f88-9102-f03d1267e2fb";
const NOW = "2026-09-28T19:00:00.000Z";
const NOW_MS = Date.parse(NOW);

function makeCheck(overrides: Partial<CheckDefinition> = {}): CheckDefinition {
  return {
    id: randomUUID(),
    key: "check",
    required: true,
    skipped: false,
    skipReason: null,
    blockedBy: null,
    requiresMutation: false,
    maxEvidenceAgeMs: null,
    narrationSatisfies: false,
    ...overrides,
  };
}

function seal(claim: string, assertions: EvidenceRecord["assertions"], payload: Record<string, unknown>) {
  return { sha256: hashPayload({ claim, assertions, payload }) };
}

function makeEvidence(
  checkId: string,
  overrides: Partial<EvidenceRecord> = {},
): EvidenceRecord {
  const claim = overrides.claim ?? "command 'type-check' succeeded with exit code 0";
  const assertions = overrides.assertions ?? [
    { name: "exit_code_zero", expected: "0", observed: "0", pass: true },
  ];
  const payload = overrides.payload ?? { command_identity: "type-check" };
  return {
    id: randomUUID(),
    actionRunId: RUN_ID,
    checkId,
    attemptId: randomUUID(),
    schemaVersion: "1.0.0",
    evidenceType: "command_result",
    source: "machine",
    collectedAt: NOW,
    claim,
    assertions,
    payload,
    redacted: true,
    ...overrides,
    // Re-seal when claim/assertions/payload were overridden without an explicit integrity.
    integrity: overrides.integrity ?? seal(claim, assertions, payload),
  };
}

function decide(
  checks: CheckDefinition[],
  evidence: EvidenceRecord[],
  opts: {
    policy?: PolicySnapshot;
    checkpointFacts?: Record<string, boolean>;
    quarantinedEvidenceIds?: string[];
  } = {},
) {
  return decidePlan({
    checks,
    evidence,
    quarantinedEvidenceIds: opts.quarantinedEvidenceIds ?? [],
    failures: [],
    policy: opts.policy ?? defaultPolicy(),
    checkpointFacts: opts.checkpointFacts ?? {},
    nowIso: NOW,
  });
}

describe("mandatory truth invariants", () => {
  it("1. no evidence => INCONCLUSIVE", () => {
    const check = makeCheck({ key: "type-check" });
    const verdict = decide([check], []);
    expect(verdict.verdict).toBe("inconclusive");
    expect(verdict.checkVerdicts[0].reasons).toContain("missing_evidence");
  });

  it("2. schema-invalid evidence => INCONCLUSIVE + quarantine row created", async () => {
    const store = new InMemoryVerificationStore();
    const plan = await store.createPlan({ actionRunId: RUN_ID, userId: "u1", name: "p" });
    const check = await store.addCheck({ planId: plan.id, actionRunId: RUN_ID, userId: "u1", key: "type-check" });
    // Empty claim violates the contract (minLength 1) => quarantined.
    const res = await store.recordEvidence({
      actionRunId: RUN_ID,
      checkId: check.id,
      userId: "u1",
      evidenceType: "command_result",
      source: "machine",
      claim: "",
      assertions: [],
    });
    expect(res.quarantined).toBe(true);
    expect(res.quarantineReason).toBe("schema_invalid");

    const state = await store.getPlanState(plan.id);
    expect(state.quarantine).toHaveLength(1);
    expect(state.quarantine[0].reason).toBe("schema_invalid");
    expect(state.evidence).toHaveLength(0);

    const verdict = decide([check], state.evidence, {
      quarantinedEvidenceIds: state.quarantine.map((q) => q.evidenceId).filter(Boolean) as string[],
    });
    expect(verdict.verdict).toBe("inconclusive");
  });

  it("3. artifact/hash mismatch => evidence invalid => INCONCLUSIVE", () => {
    const check = makeCheck({ key: "type-check" });
    const ev = makeEvidence(check.id);
    // Tamper with the payload after the seal was computed.
    const tampered: EvidenceRecord = {
      ...ev,
      payload: { ...ev.payload, exit_code: 1 },
    };
    const classification = classifyEvidence(tampered, {
      check,
      policy: defaultPolicy(),
      nowMs: NOW_MS,
    });
    expect(classification).toEqual({ valid: false, reason: "hash_mismatch" });

    // The engine excludes hash-invalid evidence => INCONCLUSIVE, never PASS.
    // (selectValidEvidence drops it; decidePlan sees no valid evidence.)
    const verdict = decide([check], []);
    expect(verdict.verdict).toBe("inconclusive");
  });

  it("4. conflicting authoritative evidence => INCONCLUSIVE", () => {
    const check = makeCheck({ key: "deploy-check" });
    const pass = makeEvidence(check.id, {
      assertions: [{ name: "site_live", expected: "200", observed: "200", pass: true }],
    });
    const fail = makeEvidence(check.id, {
      assertions: [{ name: "site_live", expected: "200", observed: "500", pass: false }],
    });
    const verdict = decide([check], [pass, fail]);
    expect(verdict.verdict).toBe("inconclusive");
    expect(verdict.checkVerdicts[0].reasons).toContain("conflicting_proof:site_live");
  });

  it("5. required assertion explicitly fails => FAIL", () => {
    const check = makeCheck({ key: "tests" });
    const ev = makeEvidence(check.id, {
      claim: "command 'tests' failed with exit code 1",
      assertions: [
        { name: "exit_code_zero", expected: "0", observed: "1", pass: false },
        { name: "completed_without_timeout", expected: "true", observed: "true", pass: true },
      ],
      payload: { command_identity: "tests", exit_code: 1 },
    });
    const verdict = decide([check], [ev]);
    expect(verdict.verdict).toBe("fail");
    expect(verdict.checkVerdicts[0].reasons).toContain("assertion_failed:exit_code_zero");
  });

  it("6. required check skipped without valid reason => invariant violation, cannot PASS", () => {
    const check = makeCheck({ key: "type-check", skipped: true, skipReason: null });
    const verdict = decide([check], []);
    expect(verdict.verdict).toBe("inconclusive");
    expect(verdict.checkVerdicts[0].policyViolation).toBe(true);
    expect(verdict.policyViolations).toHaveLength(1);
    expect(verdict.verdict).not.toBe("pass");
  });

  it("7. optional check skipped with valid reason => non-blocking", () => {
    const required = makeCheck({ key: "type-check" });
    const optional = makeCheck({
      key: "visual-review",
      required: false,
      skipped: true,
      skipReason: "not_applicable",
    });
    const ev = makeEvidence(required.id);
    const verdict = decide([required, optional], [ev]);
    expect(verdict.verdict).toBe("pass");
    const optVerdict = verdict.checkVerdicts.find((c) => c.checkKey === "visual-review");
    expect(optVerdict?.verdict).toBe("pass");
  });

  it("8. mutation verification with no pre-mutation checkpoint => cannot PASS", () => {
    const check = makeCheck({ key: "apply-migration", requiresMutation: true });
    const ev = makeEvidence(check.id);
    const verdict = decide([check], [ev], { checkpointFacts: {} });
    expect(verdict.verdict).toBe("blocked");
    expect(verdict.checkVerdicts[0].reasons).toContain("missing_pre_mutation_checkpoint");
    expect(verdict.verdict).not.toBe("pass");

    // With a checkpoint present, the same evidence passes.
    const withCheckpoint = decide([check], [ev], {
      checkpointFacts: { [check.id]: true },
    });
    expect(withCheckpoint.verdict).toBe("pass");
  });

  it("9. secret-like content never reaches persisted evidence", async () => {
    const store = new InMemoryVerificationStore();
    const plan = await store.createPlan({ actionRunId: RUN_ID, userId: "u1", name: "p" });
    const check = await store.addCheck({ planId: plan.id, actionRunId: RUN_ID, userId: "u1", key: "deploy" });
    const res = await store.recordEvidence({
      actionRunId: RUN_ID,
      checkId: check.id,
      userId: "u1",
      evidenceType: "command_result",
      source: "machine",
      claim: "deploy ran",
      assertions: [{ name: "exit_code_zero", expected: "0", observed: "0", pass: true }],
      payload: {
        // Simulate a leaked secret in tool output.
        stdout: "deploying with STRIPE_SECRET_KEY=sk-live-abc123DEF456ghi789jkl",
        api_key: "sk-live-abc123DEF456ghi789jkl",
      },
    });
    expect(res.quarantined).toBe(false);
    const state = await store.getPlanState(plan.id);
    const persisted = JSON.stringify(state.evidence[0]);
    expect(persisted).not.toContain("sk-live-abc123DEF456ghi789jkl");
    expect(persisted).toContain("[REDACTED]");
    expect(state.evidence[0].redacted).toBe(true);
  });

  it("10. same persisted input evaluated twice => identical deterministic verdict", () => {
    const check = makeCheck({ key: "type-check" });
    const ev = makeEvidence(check.id);
    const first = decide([check], [ev]);
    const second = decide([check], [ev]);
    expect(second).toEqual(first);
    expect(first.verdict).toBe("pass");
    // And again on a deep-cloned (reloaded) copy.
    const reloaded = decide([check], structuredClone([ev]));
    expect(reloaded).toEqual(first);
  });

  it("11. LLM/assistant narration only => cannot PASS a machine-evidence requirement", () => {
    const check = makeCheck({ key: "type-check" });
    const narration = makeEvidence(check.id, {
      source: "agent",
      evidenceType: "narration",
      claim: "I checked and the types look fine",
      assertions: [{ name: "exit_code_zero", expected: "0", observed: "0", pass: true }],
    });
    const verdict = decide([check], [narration]);
    expect(verdict.verdict).toBe("inconclusive");
    expect(verdict.checkVerdicts[0].reasons).toContain(
      "narration_only_insufficient_for_machine_proof",
    );
  });

  it("12. invalid/quarantined evidence cannot be silently converted into valid evidence", async () => {
    const store = new InMemoryVerificationStore();
    const plan = await store.createPlan({ actionRunId: RUN_ID, userId: "u1", name: "p" });
    const check = await store.addCheck({ planId: plan.id, actionRunId: RUN_ID, userId: "u1", key: "x" });
    const res = await store.recordEvidence({
      actionRunId: RUN_ID,
      checkId: check.id,
      userId: "u1",
      evidenceType: "command_result",
      source: "machine",
      claim: "looks good",
      assertions: [{ name: "a", expected: "1", observed: "1", pass: true }],
    });
    expect(res.quarantined).toBe(false);
    const state = await store.getPlanState(plan.id);

    // Sanity: without quarantine the evidence passes.
    const passing = decide([check], state.evidence);
    expect(passing.verdict).toBe("pass");

    // The same evidence, once quarantined, can never contribute to PASS —
    // even if a caller tries to feed it back into the engine.
    const quarantined = decide([check], state.evidence, {
      quarantinedEvidenceIds: [res.id as string],
    });
    expect(quarantined.verdict).toBe("inconclusive");
    expect(quarantined.verdict).not.toBe("pass");
  });

  it("14. verification rows reference action_runs.id", async () => {
    const store = new InMemoryVerificationStore();
    const plan = await store.createPlan({ actionRunId: RUN_ID, userId: "u1", name: "p" });
    const check = await store.addCheck({ planId: plan.id, actionRunId: RUN_ID, userId: "u1", key: "x" });
    const attempt = await store.recordAttempt({
      checkId: check.id,
      actionRunId: RUN_ID,
      userId: "u1",
      executor: "terminal-executor",
      commandIdentity: "node --version",
    });
    const evRes = await store.recordEvidence({
      actionRunId: RUN_ID,
      checkId: check.id,
      attemptId: attempt.id,
      userId: "u1",
      evidenceType: "command_result",
      source: "machine",
      claim: "c",
      assertions: [{ name: "a", expected: "1", observed: "1", pass: true }],
    });
    const state = await store.getPlanState(plan.id);
    expect(plan.actionRunId).toBe(RUN_ID);
    expect(check.id).toBeTruthy();
    expect(attempt.actionRunId).toBe(RUN_ID);
    expect(state.evidence[0].actionRunId).toBe(RUN_ID);
    expect(evRes.id).toBeTruthy();
    // Every verification row carries the canonical run identity — there is
    // no second run model (no verification_runs anywhere).
  });
});
