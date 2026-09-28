/**
 * LiTT Verification Foundation — in-memory store (tests, deterministic).
 *
 * Implements the VerificationStore port with zero infrastructure. Emitted
 * events are recorded in order with a global sequence, mirroring the
 * action_events ordering contract. getPlanState() deep-clones so tests prove
 * the verdict engine works on reloaded data, not live object references.
 */
import { randomUUID } from "node:crypto";
import type {
  CheckDefinition,
  EvidenceRecord,
  PlanVerdict,
  PolicySnapshot,
  QuarantineRecord,
  Verdict,
} from "../types";
import { EVIDENCE_SCHEMA_VERSION } from "../types";
import { evidencePayloadSchema } from "../contracts/evidence";
import { redactDeep, assertNoSecrets } from "../redaction";
import type {
  AddCheckInput,
  AttemptRecord,
  CreatePlanInput,
  EmittedEvent,
  PlanRecord,
  PlanState,
  RecordAttemptInput,
  RecordEvidenceInput,
  RecordEvidenceResult,
  RecordFailureInput,
  RecordVerdictInput,
  StoreArtifactInput,
  VerificationStore,
  VerdictRecord,
} from "./types";
import type { ArtifactRecord, FailureRecord } from "../types";

function nowIso(): string {
  return new Date().toISOString();
}

export class InMemoryVerificationStore implements VerificationStore {
  private plans = new Map<string, PlanRecord>();
  private checks = new Map<string, CheckDefinition & { planId: string; userId: string }>();
  private attempts = new Map<string, AttemptRecord & { userId: string }>();
  private evidence = new Map<string, EvidenceRecord & { userId: string }>();
  private artifacts = new Map<string, ArtifactRecord>();
  private artifactLinks: Array<{ evidenceId: string; artifactId: string }> = [];
  private verdicts: VerdictRecord[] = [];
  private failures: Array<FailureRecord & { userId: string; actionRunId: string }> = [];
  private quarantine: Array<QuarantineRecord & { userId: string; actionRunId: string }> = [];
  private policies = new Map<string, PolicySnapshot>();
  private events: EmittedEvent[] = [];
  private sequence = 0;

  /** Events emitted so far, in sequence order (for test assertions). */
  getEmittedEvents(): EmittedEvent[] {
    return [...this.events].sort((a, b) => a.sequence - b.sequence);
  }

  async createPlan(input: CreatePlanInput): Promise<PlanRecord> {
    const plan: PlanRecord = {
      id: randomUUID(),
      actionRunId: input.actionRunId,
      missionRunId: input.missionRunId ?? null,
      userId: input.userId,
      name: input.name,
      status: "open",
    };
    this.plans.set(plan.id, plan);
    await this.emitEvent(input.actionRunId, input.userId, "verification.plan_created", {
      plan_id: plan.id,
      name: plan.name,
    });
    return { ...plan };
  }

  async addCheck(input: AddCheckInput): Promise<CheckDefinition> {
    const plan = this.plans.get(input.planId);
    if (!plan) throw new Error(`[verification] unknown plan ${input.planId}`);
    const check: CheckDefinition & { planId: string; userId: string } = {
      id: randomUUID(),
      planId: input.planId,
      userId: input.userId,
      key: input.key,
      required: input.required ?? true,
      skipped: false,
      skipReason: null,
      blockedBy: input.blockedBy ?? null,
      requiresMutation: input.requiresMutation ?? false,
      maxEvidenceAgeMs: input.maxEvidenceAgeMs ?? null,
      narrationSatisfies: input.narrationSatisfies ?? false,
    };
    this.checks.set(check.id, check);
    await this.emitEvent(input.actionRunId, input.userId, "verification.check_started", {
      plan_id: input.planId,
      check_id: check.id,
      check_key: check.key,
      required: check.required,
    });
    const { planId: _p, userId: _u, ...def } = check;
    return def;
  }

  async setCheckSkip(
    checkId: string,
    skipped: boolean,
    skipReason: string | null,
  ): Promise<void> {
    const check = this.checks.get(checkId);
    if (!check) throw new Error(`[verification] unknown check ${checkId}`);
    check.skipped = skipped;
    check.skipReason = skipReason;
  }

  async recordAttempt(input: RecordAttemptInput): Promise<AttemptRecord> {
    const attempt: AttemptRecord & { userId: string } = {
      id: randomUUID(),
      checkId: input.checkId,
      actionRunId: input.actionRunId,
      userId: input.userId,
      executor: input.executor,
      commandIdentity: input.commandIdentity,
      startedAt: nowIso(),
      finishedAt: null,
      exitCode: null,
    };
    this.attempts.set(attempt.id, attempt);
    await this.emitEvent(input.actionRunId, input.userId, "verification.attempt_started", {
      check_id: input.checkId,
      attempt_id: attempt.id,
      executor: input.executor,
      command_identity: input.commandIdentity,
    });
    const { userId: _u, ...rec } = attempt;
    return rec;
  }

  async finishAttempt(attemptId: string, exitCode: number | null): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) throw new Error(`[verification] unknown attempt ${attemptId}`);
    attempt.finishedAt = nowIso();
    attempt.exitCode = exitCode;
  }

  async recordEvidence(input: RecordEvidenceInput): Promise<RecordEvidenceResult> {
    // Redact BEFORE anything is persisted.
    const redactedPayload = redactDeep(input.payload ?? {});
    const redactedAssertions = redactDeep(input.assertions);
    assertNoSecrets(redactedPayload, "evidence.payload");
    assertNoSecrets(redactedAssertions, "evidence.assertions");

    const collectedAt = input.collectedAt ?? nowIso();
    const draft = {
      schema_version: EVIDENCE_SCHEMA_VERSION,
      evidence_type: input.evidenceType,
      source: input.source,
      collected_at: collectedAt,
      action_run_id: input.actionRunId,
      check_id: input.checkId ?? null,
      attempt_id: input.attemptId ?? null,
      claim: input.claim,
      assertions: redactedAssertions,
      payload: redactedPayload,
      integrity: input.integrity ?? {},
      redacted: true,
    };

    // Schema-invalid evidence is quarantined — never silently dropped,
    // never "fixed" into valid evidence.
    const parsed = evidencePayloadSchema.safeParse(draft);
    if (!parsed.success) {
      const reason: QuarantineRecord["reason"] = "schema_invalid";
      const q = {
        id: randomUUID(),
        evidenceId: null,
        reason,
        detail: {
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
          claim: input.claim,
        },
        userId: input.userId,
        actionRunId: input.actionRunId,
      };
      this.quarantine.push(q);
      await this.emitEvent(
        input.actionRunId,
        input.userId,
        "verification.evidence_quarantined",
        { reason, check_id: input.checkId ?? null, quarantine_id: q.id },
      );
      return { id: null, quarantined: true, quarantineReason: reason, quarantineId: q.id };
    }

    const record: EvidenceRecord & { userId: string } = {
      id: randomUUID(),
      actionRunId: input.actionRunId,
      checkId: input.checkId ?? null,
      attemptId: input.attemptId ?? null,
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      evidenceType: input.evidenceType,
      source: input.source,
      collectedAt,
      claim: input.claim,
      assertions: redactedAssertions,
      payload: redactedPayload,
      integrity: input.integrity ?? {},
      redacted: true,
      userId: input.userId,
    };
    this.evidence.set(record.id, record);
    await this.emitEvent(
      input.actionRunId,
      input.userId,
      "verification.evidence_recorded",
      {
        evidence_id: record.id,
        check_id: input.checkId ?? null,
        attempt_id: input.attemptId ?? null,
        evidence_type: input.evidenceType,
        source: input.source,
      },
    );
    return { id: record.id, quarantined: false };
  }

  async storeArtifact(input: StoreArtifactInput): Promise<ArtifactRecord> {
    const existing = [...this.artifacts.values()].find((a) => a.sha256 === input.sha256);
    if (existing) return { ...existing };
    const artifact: ArtifactRecord = {
      id: randomUUID(),
      sha256: input.sha256,
      byteSize: input.byteSize,
      contentType: input.contentType ?? null,
      storageRef: input.storageRef,
      createdAt: nowIso(),
    };
    this.artifacts.set(artifact.id, artifact);
    return { ...artifact };
  }

  async linkArtifact(evidenceId: string, artifactId: string): Promise<void> {
    if (!this.evidence.has(evidenceId)) throw new Error(`[verification] unknown evidence ${evidenceId}`);
    if (!this.artifacts.has(artifactId)) throw new Error(`[verification] unknown artifact ${artifactId}`);
    if (!this.artifactLinks.some((l) => l.evidenceId === evidenceId && l.artifactId === artifactId)) {
      this.artifactLinks.push({ evidenceId, artifactId });
    }
  }

  async recordVerdict(input: RecordVerdictInput): Promise<VerdictRecord> {
    const record: VerdictRecord = {
      id: randomUUID(),
      actionRunId: input.actionRunId,
      planId: input.planId ?? null,
      checkId: input.checkId ?? null,
      verdict: input.verdict.verdict,
      decidedAt: input.verdict.decidedAt,
      rationale: {
        check_verdicts: input.verdict.checkVerdicts,
        policy_violations: input.verdict.policyViolations,
      },
      evidenceIds: input.verdict.evidenceIds,
    };
    this.verdicts.push(record);
    await this.emitEvent(
      input.actionRunId,
      input.userId,
      "verification.verdict_changed",
      {
        plan_id: input.planId ?? null,
        check_id: input.checkId ?? null,
        verdict: record.verdict,
        decided_at: record.decidedAt,
      },
    );
    return { ...record };
  }

  async recordFailure(input: RecordFailureInput): Promise<FailureRecord> {
    const failure: FailureRecord & { userId: string; actionRunId: string } = {
      id: randomUUID(),
      checkId: input.checkId ?? null,
      attemptId: input.attemptId ?? null,
      code: input.code,
      message: input.message,
      userId: input.userId,
      actionRunId: input.actionRunId,
    };
    this.failures.push(failure);
    await this.emitEvent(input.actionRunId, input.userId, "verification.failed", {
      check_id: input.checkId ?? null,
      attempt_id: input.attemptId ?? null,
      code: input.code,
    });
    const { userId: _u, actionRunId: _r, ...rec } = failure;
    return rec;
  }

  async snapshotPolicy(
    planId: string,
    actionRunId: string,
    userId: string,
    policy: PolicySnapshot,
  ): Promise<string> {
    const id = randomUUID();
    this.policies.set(planId, structuredClone(policy));
    await this.emitEvent(actionRunId, userId, "verification.policy_snapshot", {
      plan_id: planId,
      policy_snapshot_id: id,
    });
    return id;
  }

  async emitEvent(
    actionRunId: string,
    userId: string,
    type: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    this.sequence += 1;
    this.events.push({
      sequence: this.sequence,
      runId: actionRunId,
      userId,
      type,
      payload: structuredClone(payload),
    });
  }

  async getPlanState(planId: string): Promise<PlanState> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`[verification] unknown plan ${planId}`);
    const checks = [...this.checks.values()].filter((c) => c.planId === planId);
    const checkIds = new Set(checks.map((c) => c.id));
    // Deep-clone: the verdict engine must work on reloaded data, never live refs.
    return structuredClone({
      plan: { ...plan },
      checks: checks.map(({ planId: _p, userId: _u, ...c }) => c),
      attempts: [...this.attempts.values()]
        .filter((a) => checkIds.has(a.checkId))
        .map(({ userId: _u, ...a }) => a),
      evidence: [...this.evidence.values()]
        .filter((e) => e.checkId !== null && checkIds.has(e.checkId))
        .map(({ userId: _u, ...e }) => e),
      artifacts: [...this.artifacts.values()],
      artifactLinks: [...this.artifactLinks],
      verdicts: [...this.verdicts],
      failures: this.failures
        .filter((f) => f.checkId === null || checkIds.has(f.checkId))
        .map(({ userId: _u, actionRunId: _r, ...f }) => f),
      quarantine: this.quarantine.map(({ userId: _u, actionRunId: _r, ...q }) => q),
      policy: this.policies.get(planId) ?? null,
    });
  }
}

export type { Verdict };
export type { PlanVerdict };
