/**
 * LiTT Verification Foundation — Supabase store (production).
 *
 * Maps 1:1 onto the verification_* tables from migration
 * 20260928120000_verification_foundation.sql. Lifecycle events are emitted
 * through action_events via the canonical appendActionEvent (no separate
 * event table). Server-only.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appendActionEvent } from "@/lib/action-runtime/run-store";
import type { ActionEventType } from "@/lib/action-runtime/types";
import type {
  ArtifactRecord,
  CheckDefinition,
  EvidenceRecord,
  FailureRecord,
  PolicySnapshot,
  Verdict,
} from "../types";
import { EVIDENCE_SCHEMA_VERSION } from "../types";
import { evidencePayloadSchema } from "../contracts/evidence";
import { redactDeep, assertNoSecrets } from "../redaction";
import type {
  AddCheckInput,
  AttemptRecord,
  CreatePlanInput,
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

function admin() {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("[verification] Supabase admin unavailable");
  return client;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class SupabaseVerificationStore implements VerificationStore {
  async createPlan(input: CreatePlanInput): Promise<PlanRecord> {
    const id = randomUUID();
    const { error } = await admin().from("verification_plans").insert({
      id,
      action_run_id: input.actionRunId,
      mission_run_id: input.missionRunId ?? null,
      user_id: input.userId,
      name: input.name,
      status: "open",
    });
    if (error) throw new Error(`[verification] createPlan: ${error.message}`);
    await this.emitEvent(input.actionRunId, input.userId, "verification.plan_created", {
      plan_id: id,
      name: input.name,
    });
    return {
      id,
      actionRunId: input.actionRunId,
      missionRunId: input.missionRunId ?? null,
      userId: input.userId,
      name: input.name,
      status: "open",
    };
  }

  async addCheck(input: AddCheckInput): Promise<CheckDefinition> {
    const id = randomUUID();
    const { error } = await admin().from("verification_checks").insert({
      id,
      plan_id: input.planId,
      action_run_id: input.actionRunId,
      user_id: input.userId,
      key: input.key,
      required: input.required ?? true,
      status: "pending",
      blocked_by: input.blockedBy ?? null,
      requires_mutation: input.requiresMutation ?? false,
      max_evidence_age_ms: input.maxEvidenceAgeMs ?? null,
      narration_satisfies: input.narrationSatisfies ?? false,
    });
    if (error) throw new Error(`[verification] addCheck: ${error.message}`);
    await this.emitEvent(input.actionRunId, input.userId, "verification.check_started", {
      plan_id: input.planId,
      check_id: id,
      check_key: input.key,
      required: input.required ?? true,
    });
    return {
      id,
      key: input.key,
      required: input.required ?? true,
      skipped: false,
      skipReason: null,
      blockedBy: input.blockedBy ?? null,
      requiresMutation: input.requiresMutation ?? false,
      maxEvidenceAgeMs: input.maxEvidenceAgeMs ?? null,
      narrationSatisfies: input.narrationSatisfies ?? false,
    };
  }

  async setCheckSkip(
    checkId: string,
    skipped: boolean,
    skipReason: string | null,
  ): Promise<void> {
    const { error } = await admin()
      .from("verification_checks")
      .update({
        status: skipped ? "skipped" : "pending",
        skip_reason: skipReason,
      })
      .eq("id", checkId);
    if (error) throw new Error(`[verification] setCheckSkip: ${error.message}`);
  }

  async recordAttempt(input: RecordAttemptInput): Promise<AttemptRecord> {
    const id = randomUUID();
    const startedAt = nowIso();
    const { error } = await admin().from("verification_attempts").insert({
      id,
      check_id: input.checkId,
      action_run_id: input.actionRunId,
      user_id: input.userId,
      executor: input.executor,
      command_identity: input.commandIdentity,
      started_at: startedAt,
    });
    if (error) throw new Error(`[verification] recordAttempt: ${error.message}`);
    await this.emitEvent(input.actionRunId, input.userId, "verification.attempt_started", {
      check_id: input.checkId,
      attempt_id: id,
      executor: input.executor,
      command_identity: input.commandIdentity,
    });
    return {
      id,
      checkId: input.checkId,
      actionRunId: input.actionRunId,
      executor: input.executor,
      commandIdentity: input.commandIdentity,
      startedAt,
      finishedAt: null,
      exitCode: null,
    };
  }

  async finishAttempt(attemptId: string, exitCode: number | null): Promise<void> {
    const { error } = await admin()
      .from("verification_attempts")
      .update({ finished_at: nowIso(), exit_code: exitCode })
      .eq("id", attemptId);
    if (error) throw new Error(`[verification] finishAttempt: ${error.message}`);
  }

  async recordEvidence(input: RecordEvidenceInput): Promise<RecordEvidenceResult> {
    // Redact BEFORE persistence; refuse when redaction misses.
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
    const parsed = evidencePayloadSchema.safeParse(draft);
    if (!parsed.success) {
      const quarantineId = randomUUID();
      const { error } = await admin().from("verification_quarantine").insert({
        id: quarantineId,
        action_run_id: input.actionRunId,
        evidence_id: null,
        user_id: input.userId,
        reason: "schema_invalid",
        detail: {
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
          claim: input.claim,
        },
      });
      if (error) throw new Error(`[verification] quarantine insert: ${error.message}`);
      await this.emitEvent(
        input.actionRunId,
        input.userId,
        "verification.evidence_quarantined",
        {
          reason: "schema_invalid",
          check_id: input.checkId ?? null,
          quarantine_id: quarantineId,
        },
      );
      return {
        id: null,
        quarantined: true,
        quarantineReason: "schema_invalid",
        quarantineId,
      };
    }

    const id = randomUUID();
    const { error } = await admin().from("verification_evidence").insert({
      id,
      action_run_id: input.actionRunId,
      check_id: input.checkId ?? null,
      attempt_id: input.attemptId ?? null,
      user_id: input.userId,
      schema_version: EVIDENCE_SCHEMA_VERSION,
      evidence_type: input.evidenceType,
      source: input.source,
      collected_at: collectedAt,
      claim: input.claim,
      assertion: redactedAssertions,
      payload: redactedPayload,
      integrity: input.integrity ?? {},
      redacted: true,
    });
    if (error) throw new Error(`[verification] recordEvidence: ${error.message}`);
    await this.emitEvent(
      input.actionRunId,
      input.userId,
      "verification.evidence_recorded",
      {
        evidence_id: id,
        check_id: input.checkId ?? null,
        attempt_id: input.attemptId ?? null,
        evidence_type: input.evidenceType,
        source: input.source,
      },
    );
    return { id, quarantined: false };
  }

  async storeArtifact(input: StoreArtifactInput): Promise<ArtifactRecord> {
    const id = randomUUID();
    const { data, error } = await admin()
      .from("verification_artifacts")
      .upsert(
        {
          id,
          sha256: input.sha256,
          byte_size: input.byteSize,
          content_type: input.contentType ?? null,
          storage_ref: input.storageRef,
        },
        { onConflict: "sha256" },
      )
      .select("id, sha256, byte_size, content_type, storage_ref, created_at")
      .single();
    if (error || !data) {
      throw new Error(`[verification] storeArtifact: ${error?.message ?? "no row"}`);
    }
    return {
      id: data.id,
      sha256: data.sha256,
      byteSize: Number(data.byte_size),
      contentType: data.content_type,
      storageRef: data.storage_ref,
      createdAt: data.created_at,
    };
  }

  async linkArtifact(evidenceId: string, artifactId: string): Promise<void> {
    const { error } = await admin().from("verification_artifact_links").upsert(
      { evidence_id: evidenceId, artifact_id: artifactId },
      { onConflict: "evidence_id,artifact_id" },
    );
    if (error) throw new Error(`[verification] linkArtifact: ${error.message}`);
  }

  async recordVerdict(input: RecordVerdictInput): Promise<VerdictRecord> {
    const id = randomUUID();
    const { error } = await admin().from("verification_verdicts").insert({
      id,
      action_run_id: input.actionRunId,
      plan_id: input.planId ?? null,
      check_id: input.checkId ?? null,
      user_id: input.userId,
      verdict: input.verdict.verdict,
      decided_at: input.verdict.decidedAt,
      rationale: {
        check_verdicts: input.verdict.checkVerdicts,
        policy_violations: input.verdict.policyViolations,
      },
      evidence_ids: input.verdict.evidenceIds,
    });
    if (error) throw new Error(`[verification] recordVerdict: ${error.message}`);
    await this.emitEvent(
      input.actionRunId,
      input.userId,
      "verification.verdict_changed",
      {
        plan_id: input.planId ?? null,
        check_id: input.checkId ?? null,
        verdict: input.verdict.verdict,
        decided_at: input.verdict.decidedAt,
      },
    );
    return {
      id,
      actionRunId: input.actionRunId,
      planId: input.planId ?? null,
      checkId: input.checkId ?? null,
      verdict: input.verdict.verdict,
      decidedAt: input.verdict.decidedAt,
      rationale: {},
      evidenceIds: input.verdict.evidenceIds,
    };
  }

  async recordFailure(input: RecordFailureInput): Promise<FailureRecord> {
    const id = randomUUID();
    const { error } = await admin().from("verification_failures").insert({
      id,
      action_run_id: input.actionRunId,
      attempt_id: input.attemptId ?? null,
      check_id: input.checkId ?? null,
      user_id: input.userId,
      code: input.code,
      message: input.message,
    });
    if (error) throw new Error(`[verification] recordFailure: ${error.message}`);
    await this.emitEvent(input.actionRunId, input.userId, "verification.failed", {
      check_id: input.checkId ?? null,
      attempt_id: input.attemptId ?? null,
      code: input.code,
    });
    return {
      id,
      checkId: input.checkId ?? null,
      attemptId: input.attemptId ?? null,
      code: input.code,
      message: input.message,
    };
  }

  async snapshotPolicy(
    planId: string,
    actionRunId: string,
    userId: string,
    policy: PolicySnapshot,
  ): Promise<string> {
    const id = randomUUID();
    const { error } = await admin().from("verification_policy_snapshots").insert({
      id,
      plan_id: planId,
      action_run_id: actionRunId,
      user_id: userId,
      policy,
    });
    if (error) throw new Error(`[verification] snapshotPolicy: ${error.message}`);
    return id;
  }

  async emitEvent(
    actionRunId: string,
    userId: string,
    type: ActionEventType,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    // Canonical spine: verification lifecycle events reuse action_events.
    await appendActionEvent({
      runId: actionRunId,
      userId,
      type,
      payload,
    });
  }

  async getPlanState(planId: string): Promise<PlanState> {
    const db = admin();
    const { data: planRow, error: planError } = await db
      .from("verification_plans")
      .select("*")
      .eq("id", planId)
      .single();
    if (planError || !planRow) {
      throw new Error(`[verification] unknown plan ${planId}`);
    }
    const { data: checkRows } = await db
      .from("verification_checks")
      .select("*")
      .eq("plan_id", planId)
      .order("key");
    const checks: CheckDefinition[] = (checkRows ?? []).map((r) => ({
      id: r.id,
      key: r.key,
      required: r.required,
      skipped: r.status === "skipped",
      skipReason: r.skip_reason,
      blockedBy: r.blocked_by,
      requiresMutation: r.requires_mutation,
      maxEvidenceAgeMs:
        r.max_evidence_age_ms === null ? null : Number(r.max_evidence_age_ms),
      narrationSatisfies: r.narration_satisfies ?? false,
    }));
    const checkIds = checks.map((c) => c.id);
    const { data: attemptRows } = checkIds.length
      ? await db.from("verification_attempts").select("*").in("check_id", checkIds)
      : { data: [] };
    const { data: evidenceRows } = checkIds.length
      ? await db.from("verification_evidence").select("*").in("check_id", checkIds)
      : { data: [] };
    const evidence: EvidenceRecord[] = (evidenceRows ?? []).map((r) => ({
      id: r.id,
      actionRunId: r.action_run_id,
      checkId: r.check_id,
      attemptId: r.attempt_id,
      schemaVersion: r.schema_version,
      evidenceType: r.evidence_type,
      source: r.source,
      collectedAt: r.collected_at,
      claim: r.claim,
      assertions: r.assertion ?? [],
      payload: r.payload ?? {},
      integrity: r.integrity ?? {},
      redacted: r.redacted,
    }));
    const evidenceIds = evidence.map((e) => e.id);
    const { data: linkRows } = evidenceIds.length
      ? await db
          .from("verification_artifact_links")
          .select("evidence_id, artifact_id")
          .in("evidence_id", evidenceIds)
      : { data: [] };
    const artifactIds = [...new Set((linkRows ?? []).map((l) => l.artifact_id))];
    const { data: artifactRows } = artifactIds.length
      ? await db.from("verification_artifacts").select("*").in("id", artifactIds)
      : { data: [] };
    const { data: verdictRows } = await db
      .from("verification_verdicts")
      .select("*")
      .eq("plan_id", planId)
      .order("decided_at");
    const { data: failureRows } = checkIds.length
      ? await db.from("verification_failures").select("*").in("check_id", checkIds)
      : { data: [] };
    const { data: quarantineRows } = await db
      .from("verification_quarantine")
      .select("*")
      .eq("action_run_id", planRow.action_run_id)
      .order("quarantined_at");
    const { data: policyRows } = await db
      .from("verification_policy_snapshots")
      .select("policy")
      .eq("plan_id", planId)
      .order("created_at", { ascending: false })
      .limit(1);

    return {
      plan: {
        id: planRow.id,
        actionRunId: planRow.action_run_id,
        missionRunId: planRow.mission_run_id,
        userId: planRow.user_id,
        name: planRow.name,
        status: planRow.status,
      },
      checks,
      attempts: (attemptRows ?? []).map((r) => ({
        id: r.id,
        checkId: r.check_id,
        actionRunId: r.action_run_id,
        executor: r.executor,
        commandIdentity: r.command_identity,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        exitCode: r.exit_code,
      })),
      evidence,
      artifacts: (artifactRows ?? []).map((r) => ({
        id: r.id,
        sha256: r.sha256,
        byteSize: Number(r.byte_size),
        contentType: r.content_type,
        storageRef: r.storage_ref,
        createdAt: r.created_at,
      })),
      artifactLinks: (linkRows ?? []).map((l) => ({
        evidenceId: l.evidence_id,
        artifactId: l.artifact_id,
      })),
      verdicts: (verdictRows ?? []).map((r) => ({
        id: r.id,
        actionRunId: r.action_run_id,
        planId: r.plan_id,
        checkId: r.check_id,
        verdict: r.verdict as Verdict,
        decidedAt: r.decided_at,
        rationale: r.rationale ?? {},
        evidenceIds: r.evidence_ids ?? [],
      })),
      failures: (failureRows ?? []).map((r) => ({
        id: r.id,
        checkId: r.check_id,
        attemptId: r.attempt_id,
        code: r.code,
        message: r.message,
      })),
      quarantine: (quarantineRows ?? []).map((r) => ({
        id: r.id,
        evidenceId: r.evidence_id,
        reason: r.reason,
        detail: r.detail ?? {},
      })),
      policy: (policyRows?.[0]?.policy as PolicySnapshot) ?? null,
    };
  }
}
