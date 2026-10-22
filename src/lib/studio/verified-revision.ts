/**
 * Verified-revision publish gate (Repair R5-B) — pure decision logic.
 *
 * The defect this repairs: verification state was per-run ephemeral. A
 * quality verdict lived on the run that produced it, nothing bound it to
 * the workspace content it covered, and the publish path read a FRESH
 * run's own (empty) evidence session instead of the project's canonical
 * record — so a publish after a verified build + verified edit failed
 * with "The build did not pass its quality checks", while nothing
 * anywhere could have proven that published bytes equal verified bytes.
 *
 * The invariant enforced here:
 *
 *   A published artifact must correspond to the EXACT workspace revision
 *   that passed the required checks.
 *
 * A settled run whose quality verdict was ok records the workspace
 * revision it verified (`RunResult.verifiedRevision`, persisted on the
 * run's terminal outcome event). The publish gate compares that record
 * against the CURRENT workspace revision, computed live from the
 * canonical file surface (never a cached status projection):
 *
 *   - no verified record for the project        → deny (never fabricate)
 *   - current revision cannot be established     → deny (fail closed)
 *   - record's revision ≠ current revision       → deny (stale evidence:
 *     the workspace changed after verification — a second edit, a
 *     concurrent edit, anything; the only remedy is re-verification)
 *   - revisions match                            → allow
 *
 * Revision granularity is WHOLE-WORKSPACE on purpose: quality evidence
 * is stage-based (build/test/preview over the project as a whole), not
 * per-file, so there is no honest per-file subset to preserve after an
 * edit. Whole-revision invalidation is the truthful behavior; see the
 * R5 report for the scenario-(c) analysis.
 */

import type { QualityLoopSnapshot } from "@/lib/litt-intelligence/quality-loop-flow";

/** Tool ids whose execution publishes the project's current workspace. */
const DEPLOY_TOOL_IDS: ReadonlySet<string> = new Set([
  "project.deploy",
  "deploy.production",
  "deploy.preview",
]);

export function isDeployToolId(toolId: string | null | undefined): boolean {
  return typeof toolId === "string" && DEPLOY_TOOL_IDS.has(toolId);
}

/** One settled run's verification claim, read from its outcome record. */
export interface SettledRunVerification {
  runId: string;
  /** The run's quality verdict was ok. */
  verdictOk: boolean;
  /** Workspace revision the verdict covers; null when never recorded. */
  verifiedRevision: string | null;
}

/** The canonical verified-revision record for a project. */
export interface VerifiedRevisionRecord {
  revision: string;
  runId: string;
}

/**
 * Pick the canonical record from a project's settled runs, NEWEST FIRST
 * (the caller supplies recency order — e.g. listActionRuns' created
 * order). The newest run with an ok verdict AND a recorded revision
 * wins; runs without either prove nothing and are skipped. A later run
 * that FAILED verification does not erase an earlier verified revision —
 * but it also does not extend it: the gate still compares revisions, so
 * any content change since that earlier verification denies the publish
 * until a fresh verification passes.
 */
export function selectVerifiedRevision(
  settledRuns: readonly SettledRunVerification[],
): VerifiedRevisionRecord | null {
  for (const run of settledRuns) {
    if (run.verdictOk && run.verifiedRevision) {
      return { revision: run.verifiedRevision, runId: run.runId };
    }
  }
  return null;
}

export type PublishGateDenialCode =
  | "no_verified_revision"
  | "current_revision_unknown"
  | "stale_revision";

export type PublishGateDecision =
  | {
      allowed: true;
      code: "verified_revision";
      verifiedRevision: string;
      currentRevision: string;
      verifiedByRunId: string;
    }
  | {
      allowed: false;
      code: PublishGateDenialCode;
      reason: string;
      verifiedRevision: string | null;
      currentRevision: string | null;
      verifiedByRunId: string | null;
    };

/**
 * Decide whether a publish may proceed for the workspace as it exists
 * RIGHT NOW. Pure: the caller supplies the canonical record (or null)
 * and the freshly computed current revision (or null).
 */
export function evaluatePublishGate(opts: {
  record: VerifiedRevisionRecord | null;
  currentRevision: string | null;
}): PublishGateDecision {
  const { record, currentRevision } = opts;
  if (!record) {
    return {
      allowed: false,
      code: "no_verified_revision",
      reason:
        "This project has no verified build on record, so there is nothing verified to publish. Run a build and verification first.",
      verifiedRevision: null,
      currentRevision,
      verifiedByRunId: null,
    };
  }
  if (!currentRevision) {
    return {
      allowed: false,
      code: "current_revision_unknown",
      reason:
        "The workspace could not be read to confirm it matches the verified build, so the publish was not performed.",
      verifiedRevision: record.revision,
      currentRevision: null,
      verifiedByRunId: record.runId,
    };
  }
  if (record.revision !== currentRevision) {
    return {
      allowed: false,
      code: "stale_revision",
      reason:
        "The workspace changed after it was verified, so the verified result no longer covers what would be published. Re-run verification, then publish again.",
      verifiedRevision: record.revision,
      currentRevision,
      verifiedByRunId: record.runId,
    };
  }
  return {
    allowed: true,
    code: "verified_revision",
    verifiedRevision: record.revision,
    currentRevision,
    verifiedByRunId: record.runId,
  };
}

/**
 * Does the paused run's OWN quality session carry real build evidence?
 *
 * This is the single-run case: a run that built (or mutated) files and
 * then paused at its own deploy gate. Its verification is evaluated by
 * the resumed finalize against its own session — the canonical-record
 * gate must not pre-deny it for lacking a PRIOR run's record. The test
 * is deliberately strict (recorded BUILD-stage evidence or a recorded
 * successful mutation in the session snapshot); an empty or
 * marker-only session does not qualify, so a publish-only run cannot
 * smuggle itself through this path.
 */
export function sessionHasVerificationEvidence(
  snapshot: QualityLoopSnapshot | null | undefined,
): boolean {
  if (!snapshot) return false;
  if (snapshot.mutationSeen === true) return true;
  const build = snapshot.state?.stages?.build;
  return Array.isArray(build?.evidence) && build.evidence.length > 0;
}
