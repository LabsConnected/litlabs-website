/**
 * Acceptance Verification Engine
 *
 * Verifies acceptance criteria using concrete runtime evidence.
 * A criterion can become VERIFIED only from real evidence —
 * never from model text or fabricated prose.
 *
 * Verification sources:
 * - check_evidence: a passing CheckEvidence record verifies the criterion
 * - mutation_evidence: a succeeded MutationEvidence record verifies the criterion
 * - file_read_evidence: reading a file and checking its content
 * - browser_evidence: browser automation result
 * - deterministic_verifier: an explicit deterministic function
 * - manual_review: explicit human review action
 *
 * Phase 9 — Studio Control Plane V1
 */

import { randomUUID } from "crypto";
import { createHash } from "crypto";
import type { WorkspaceTransport } from "./workspace-transport";
import type { AcceptanceEvidence, PlanCriterion, VerificationSource } from "./acceptance-evidence";
import { isAcceptanceStale } from "./acceptance-evidence";
import { getAcceptanceEvidenceStore } from "./acceptance-evidence-store";
import type { CheckEvidence } from "./check-evidence";
import type { MutationEvidence } from "./mutation-evidence";
import { getRunEventStore } from "./run-event-store";
import { createRunEvent } from "./run-events";

// ─── Types ───────────────────────────────────────────────────────

export interface VerificationContext {
  runId: string;
  projectId: string;
  transport: WorkspaceTransport;
  /** Check evidence from the current run */
  checkEvidence: CheckEvidence[];
  /** Mutation evidence from the current run */
  mutationEvidence: MutationEvidence[];
  /** Plan criteria to verify */
  criteria: PlanCriterion[];
}

export interface VerificationResult {
  evidence: AcceptanceEvidence[];
}

// ─── Deterministic Verifier Function ─────────────────────────────

/**
 * A deterministic verifier is an explicit function that checks
 * whether a criterion is met. It must return a boolean and
 * a human-readable summary. It CANNOT be model text.
 */
export type DeterministicVerifier = (
  context: VerificationContext,
) => Promise<{ passed: boolean; summary: string; evidenceRefs: string[] }>;

// ─── Capture Code State ──────────────────────────────────────────

async function captureCodeState(transport: WorkspaceTransport): Promise<{
  headSha: string;
  workingTreeDiffHash: string;
}> {
  let headSha = "unknown";
  try {
    const log = await transport.gitLog({ maxCount: 1 });
    headSha = log.commits[0]?.sha ?? "unknown";
  } catch { /* ok */ }

  let workingTreeDiffHash = "empty";
  try {
    const { diff } = await transport.gitDiff();
    workingTreeDiffHash = diff
      ? createHash("sha256").update(diff, "utf-8").digest("hex")
      : "empty";
  } catch { /* ok */ }

  return { headSha, workingTreeDiffHash };
}

// ─── Verify Single Criterion ─────────────────────────────────────

async function verifyCriterion(
  criterion: PlanCriterion,
  codeState: { headSha: string; workingTreeDiffHash: string },
  context: VerificationContext,
  verifier?: DeterministicVerifier,
): Promise<AcceptanceEvidence> {
  const store = getAcceptanceEvidenceStore();
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  // Check if criterion already exists (prevents dropping between plan and verification)
  const exists = await store.criterionExists(context.runId, criterion.criterion);
  if (exists) {
    // Idempotent: return existing record
    const existing = (await store.listByRun(context.runId)).find(
      (e) => e.criterion === criterion.criterion,
    );
    if (existing) return existing;
  }

  const baseEvidence: AcceptanceEvidence = {
    id,
    runId: context.runId,
    projectId: context.projectId,
    criterion: criterion.criterion,
    required: criterion.required,
    status: "verifying",
    evidenceRefs: [],
    headSha: codeState.headSha,
    workingTreeDiffHash: codeState.workingTreeDiffHash,
    stale: false,
    startedAt,
  };
  await store.insert(baseEvidence);

  // Emit event
  const runEventStore = getRunEventStore();
  await runEventStore.insert(createRunEvent(context.runId, context.projectId, "tool_started", {
    toolId: "acceptance_verification",
    criterion: criterion.criterion,
  }));

  let status: AcceptanceEvidence["status"] = "queued";
  let verificationSource: VerificationSource | undefined = criterion.verificationSource;
  let evidenceRefs: string[] = [];
  let verificationSummary: string | undefined;
  let failureReason: string | undefined;
  let skipReason: string | undefined;

  try {
    switch (criterion.verificationSource) {
      case "check_evidence": {
        // Verify by finding a passing check of the specified kind
        const matchingChecks = criterion.checkKind
          ? context.checkEvidence.filter((c) => c.kind === criterion.checkKind && c.status === "passed" && !c.stale)
          : context.checkEvidence.filter((c) => c.status === "passed" && !c.stale);

        if (matchingChecks.length > 0) {
          status = "verified";
          evidenceRefs = matchingChecks.map((c) => c.id);
          verificationSummary = `Verified by ${matchingChecks.length} passing check(s): ${matchingChecks.map((c) => c.kind).join(", ")}`;
        } else {
          status = "failed";
          failureReason = criterion.checkKind
            ? `No passing ${criterion.checkKind} check found`
            : "No passing checks found to verify criterion";
        }
        break;
      }

      case "mutation_evidence": {
        // Verify by finding a succeeded mutation
        const succeededMutations = context.mutationEvidence.filter(
          (m) => m.status === "succeeded",
        );
        if (succeededMutations.length > 0) {
          status = "verified";
          evidenceRefs = succeededMutations.map((m) => m.id);
          verificationSummary = `Verified by ${succeededMutations.length} succeeded mutation(s)`;
        } else {
          status = "failed";
          failureReason = "No succeeded mutations found to verify criterion";
        }
        break;
      }

      case "deterministic_verifier": {
        if (!verifier) {
          status = "failed";
          failureReason = "Deterministic verifier not provided";
          break;
        }
        const result = await verifier(context);
        if (result.passed) {
          status = "verified";
          evidenceRefs = result.evidenceRefs;
          verificationSummary = result.summary;
        } else {
          status = "failed";
          failureReason = result.summary || "Deterministic verifier returned false";
          evidenceRefs = result.evidenceRefs;
        }
        break;
      }

      case "file_read_evidence": {
        // Verify by reading a file — the verifier function handles the check
        if (!verifier) {
          status = "failed";
          failureReason = "File read verifier not provided";
          break;
        }
        const result = await verifier(context);
        if (result.passed) {
          status = "verified";
          evidenceRefs = result.evidenceRefs;
          verificationSummary = result.summary;
        } else {
          status = "failed";
          failureReason = result.summary || "File content check failed";
        }
        break;
      }

      case "browser_evidence": {
        // Browser evidence requires a verifier or external browser check result
        if (!verifier) {
          status = "failed";
          failureReason = "Browser verification not implemented for this criterion";
          break;
        }
        const result = await verifier(context);
        if (result.passed) {
          status = "verified";
          evidenceRefs = result.evidenceRefs;
          verificationSummary = result.summary;
        } else {
          status = "failed";
          failureReason = result.summary || "Browser check failed";
        }
        break;
      }

      case "manual_review": {
        // Manual review requires explicit human action — cannot be auto-verified
        status = "queued";
        skipReason = "Awaiting manual review";
        break;
      }

      default: {
        // No verification source specified — cannot verify
        status = "failed";
        failureReason = "No verification source specified";
        break;
      }
    }
  } catch (err) {
    status = "failed";
    failureReason = `Verification error: ${err instanceof Error ? err.message : String(err)}`;
  }

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startTime;

  const finalEvidence: AcceptanceEvidence = {
    ...baseEvidence,
    status,
    verificationSource,
    evidenceRefs,
    verificationSummary,
    failureReason,
    skipReason,
    completedAt,
    durationMs,
  };

  await store.update(id, {
    status,
    verificationSource,
    evidenceRefs,
    verificationSummary,
    failureReason,
    skipReason,
    completedAt,
    durationMs,
  });

  // Emit result event
  await runEventStore.insert(createRunEvent(
    context.runId,
    context.projectId,
    status === "verified" ? "check_passed" : status === "failed" ? "check_failed" : "check_skipped",
    { checkId: `acceptance:${criterion.criterion.slice(0, 40)}`, status },
    { evidenceId: id },
  ));

  return finalEvidence;
}

// ─── Verify All Criteria ─────────────────────────────────────────

/**
 * Verify all acceptance criteria from the plan.
 * Returns AcceptanceEvidence[] — one record per criterion.
 *
 * Criteria cannot be silently dropped: every criterion from the plan
 * must produce an evidence record, even if it's "skipped" or "failed".
 */
export async function verifyAcceptanceCriteria(
  context: VerificationContext,
  verifiers?: Map<string, DeterministicVerifier>,
): Promise<VerificationResult> {
  const { transport } = context;
  const codeState = await captureCodeState(transport);
  const evidence: AcceptanceEvidence[] = [];

  for (const criterion of context.criteria) {
    const verifier = verifiers?.get(criterion.criterion);
    const result = await verifyCriterion(criterion, codeState, context, verifier);
    evidence.push(result);
  }

  return { evidence };
}

// ─── Invalidate Stale Acceptance Evidence ────────────────────────

/**
 * Mark all acceptance evidence for a run as stale if the code state
 * has changed. Called after a new mutation occurs.
 */
export async function invalidateStaleAcceptanceEvidence(
  runId: string,
  currentHeadSha: string,
  currentWorkingTreeDiffHash: string,
): Promise<void> {
  const store = getAcceptanceEvidenceStore();
  const records = await store.listByRun(runId);

  for (const record of records) {
    if (isAcceptanceStale(record, currentHeadSha, currentWorkingTreeDiffHash)) {
      await store.update(record.id, { stale: true });
    }
  }
}

// ─── Model Claim Rejection ───────────────────────────────────────

/**
 * Reject a model claim that a criterion is verified when there is
 * no runtime evidence to back it.
 *
 * This function exists to make the rejection explicit and testable.
 * The model may output "I've verified that the feature works" but
 * unless there is concrete AcceptanceEvidence with status "verified"
 * and evidenceRefs pointing to real records, the claim is rejected.
 */
export function rejectModelClaim(
  claim: string,
  acceptanceEvidence: AcceptanceEvidence[],
): { rejected: boolean; reason: string } {
  // Check if any acceptance evidence actually verifies this claim
  const matching = acceptanceEvidence.find(
    (e) => e.criterion === claim && e.status === "verified" && !e.stale && e.evidenceRefs.length > 0,
  );

  if (!matching) {
    return {
      rejected: true,
      reason: `Model claim "${claim}" rejected: no verified acceptance evidence with concrete evidence references found`,
    };
  }

  return { rejected: false, reason: "Claim backed by verified acceptance evidence" };
}
