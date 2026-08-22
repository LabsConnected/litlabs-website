/**
 * Phase 10.1 — Contract Freeze: Review Readiness Selector Tests
 *
 * These tests pin the review-readiness derivation contract.
 * Presentation work cannot silently alter operational behavior.
 *
 * Phase 10.1 — Studio Control Plane V1
 */

import { describe, it, expect } from "vitest";
import { deriveReviewReadiness, type ReviewReadinessInput } from "@/app/(app)/studio/lib/review-readiness";
import type { MutationEvidence } from "@/lib/litt-intelligence/mutation-evidence";
import type { CheckEvidence } from "@/lib/litt-intelligence/check-evidence";
import type { AcceptanceEvidence } from "@/lib/litt-intelligence/acceptance-evidence";
import type { ReviewCheckpoint } from "@/lib/litt-intelligence/review-checkpoint";

// ─── Helpers ─────────────────────────────────────────────────────

function makeMutation(overrides: Partial<MutationEvidence> = {}): MutationEvidence {
  return {
    id: `mut-${Math.random().toString(36).slice(2, 8)}`,
    runId: "run-1",
    projectId: "proj-1",
    toolId: "files.write",
    workspaceId: "ws-1",
    branch: "feat/test",
    baseSha: "base123",
    headShaBefore: "abc123",
    paths: ["src/foo.ts"],
    beforeHashes: { "src/foo.ts": null },
    afterHashes: { "src/foo.ts": "hash1" },
    status: "succeeded",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCheck(overrides: Partial<CheckEvidence> & { kind: CheckEvidence["kind"] }): CheckEvidence {
  return {
    id: `check-${overrides.kind}-${Math.random().toString(36).slice(2, 8)}`,
    runId: "run-1",
    projectId: "proj-1",
    command: `pnpm ${overrides.kind}`,
    cwd: "/workspace",
    required: true,
    status: "passed",
    exitCode: 0,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 1000,
    headSha: "abc123",
    workingTreeDiffHash: "diff-hash-1",
    ...overrides,
  };
}

function makeAcceptance(overrides: Partial<AcceptanceEvidence> = {}): AcceptanceEvidence {
  return {
    id: `acc-${Math.random().toString(36).slice(2, 8)}`,
    runId: "run-1",
    projectId: "proj-1",
    criterion: "Feature works correctly",
    required: true,
    status: "verified",
    verificationSource: "check_evidence",
    evidenceRefs: ["check-1"],
    verificationSummary: "Verified by passing check",
    headSha: "abc123",
    workingTreeDiffHash: "diff-hash-1",
    stale: false,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 100,
    ...overrides,
  };
}

function makeCheckpoint(overrides: Partial<ReviewCheckpoint> = {}): ReviewCheckpoint {
  return {
    id: `cp-${Math.random().toString(36).slice(2, 8)}`,
    runId: "run-1",
    projectId: "proj-1",
    decision: "pending",
    headSha: "abc123",
    workingTreeDiffHash: "diff-hash-1",
    mutationEvidenceIds: ["mut-1"],
    checkEvidenceIds: ["check-1"],
    acceptanceEvidenceIds: ["acc-1"],
    blockers: [],
    stale: false,
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeReadyInput(overrides: Partial<ReviewReadinessInput> = {}): ReviewReadinessInput {
  return {
    mutationEvidence: [makeMutation()],
    checkEvidence: [
      makeCheck({ kind: "typecheck", status: "passed" }),
      makeCheck({ kind: "test", status: "passed" }),
      makeCheck({ kind: "build", status: "passed" }),
    ],
    acceptanceEvidence: [
      makeAcceptance({ criterion: "Feature works", status: "verified", evidenceRefs: ["check-1"] }),
    ],
    reviewCheckpoint: null,
    runEvents: [],
    checksRunning: false,
    isActing: false,
    pendingApprovalCount: 0,
    headSha: "abc123",
    workingTreeDiffHash: "diff-hash-1",
    workingTreeClean: false,
    unresolvedBlockingEvents: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("Phase 10.1 — Review Readiness Selector (Contract Freeze)", () => {
  // ── Readiness levels ──

  describe("readiness levels", () => {
    it("not_started: no mutations, not acting", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        mutationEvidence: [],
        checkEvidence: [],
        acceptanceEvidence: [],
      }));
      expect(state.readiness).toBe("not_started");
      expect(state.readyForReview).toBe(false);
      expect(state.changes.total).toBe(0);
    });

    it("running: agent is acting", () => {
      const state = deriveReviewReadiness(makeReadyInput({ isActing: true }));
      expect(state.readiness).toBe("running");
    });

    it("running: checks are running", () => {
      const state = deriveReviewReadiness(makeReadyInput({ checksRunning: true }));
      expect(state.readiness).toBe("running");
    });

    it("blocked: pending approval", () => {
      const state = deriveReviewReadiness(makeReadyInput({ pendingApprovalCount: 1 }));
      expect(state.readiness).toBe("blocked");
      expect(state.pendingApprovals).toBe(1);
    });

    it("ready_for_review: all evidence passing, no checkpoint", () => {
      const state = deriveReviewReadiness(makeReadyInput());
      expect(state.readiness).toBe("ready_for_review");
      expect(state.readyForReview).toBe(true);
      expect(state.reviewApproved).toBe(false);
    });

    it("approved: checkpoint approved and fresh", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "approved", stale: false }),
      }));
      expect(state.readiness).toBe("approved");
      expect(state.reviewApproved).toBe(true);
    });

    it("changes_requested: checkpoint has changes_requested", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "changes_requested", stale: false }),
      }));
      expect(state.readiness).toBe("changes_requested");
      expect(state.changesRequested).toBe(true);
      expect(state.readyForReview).toBe(false);
    });

    it("stale: checkpoint is stale", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "approved", stale: true }),
      }));
      expect(state.readiness).toBe("stale");
      expect(state.hasStaleEvidence).toBe(true);
    });

    it("blocked: checks failed", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "failed", exitCode: 1 }),
          makeCheck({ kind: "test", status: "passed" }),
          makeCheck({ kind: "build", status: "passed" }),
        ],
      }));
      expect(state.readiness).toBe("blocked");
      expect(state.checks.failedRequired).toBe(1);
      expect(state.blockers.some((b) => b.category === "checks")).toBe(true);
    });

    it("blocked: acceptance not verified", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        acceptanceEvidence: [
          makeAcceptance({ status: "failed", failureReason: "Not met" }),
        ],
      }));
      expect(state.readiness).toBe("blocked");
      expect(state.acceptance.failed).toBe(1);
      expect(state.blockers.some((b) => b.category === "acceptance")).toBe(true);
    });
  });

  // ── Summaries ──

  describe("check summary", () => {
    it("summarizes all check statuses", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "passed" }),
          makeCheck({ kind: "lint", status: "failed", required: false }),
          makeCheck({ kind: "test", status: "skipped", required: false }),
          makeCheck({ kind: "build", status: "running" }),
          makeCheck({ kind: "browser", status: "passed", stale: true }),
        ],
      }));
      expect(state.checks.total).toBe(5);
      expect(state.checks.passed).toBe(1); // only non-stale passed
      expect(state.checks.failed).toBe(1);
      expect(state.checks.skipped).toBe(1);
      expect(state.checks.running).toBe(1);
      expect(state.checks.stale).toBe(1);
    });
  });

  describe("acceptance summary", () => {
    it("summarizes all acceptance statuses", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        acceptanceEvidence: [
          makeAcceptance({ criterion: "A", status: "verified" }),
          makeAcceptance({ criterion: "B", status: "failed", required: false }),
          makeAcceptance({ criterion: "C", status: "skipped", required: false }),
          makeAcceptance({ criterion: "D", status: "verified", stale: true }),
        ],
      }));
      expect(state.acceptance.total).toBe(4);
      expect(state.acceptance.verified).toBe(1); // only non-stale
      expect(state.acceptance.failed).toBe(1);
      expect(state.acceptance.skipped).toBe(1);
      expect(state.acceptance.stale).toBe(1);
    });
  });

  describe("changes summary", () => {
    it("summarizes added, modified, deleted", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        mutationEvidence: [
          makeMutation({
            paths: ["src/new.ts", "src/modified.ts", "src/deleted.ts"],
            beforeHashes: { "src/new.ts": null, "src/modified.ts": "old", "src/deleted.ts": "old" },
            afterHashes: { "src/new.ts": "new", "src/modified.ts": "new", "src/deleted.ts": null },
          }),
        ],
      }));
      expect(state.changes.added).toBe(1);
      expect(state.changes.modified).toBe(1);
      expect(state.changes.deleted).toBe(1);
      expect(state.changes.total).toBe(3);
      expect(state.changes.paths).toContain("src/new.ts");
    });
  });

  // ── Provenance ──

  describe("provenance", () => {
    it("includes headSha and diff hash", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        headSha: "abc123def456",
        workingTreeDiffHash: "diff-hash-xyz",
        workingTreeClean: false,
      }));
      expect(state.provenance).not.toBeNull();
      expect(state.provenance!.headSha).toBe("abc123def456");
      expect(state.provenance!.workingTreeDiffHash).toBe("diff-hash-xyz");
      expect(state.provenance!.clean).toBe(false);
    });

    it("provenance is null when headSha is empty", () => {
      const state = deriveReviewReadiness(makeReadyInput({ headSha: "" }));
      expect(state.provenance).toBeNull();
    });
  });

  // ── Permitted actions ──

  describe("permitted actions", () => {
    it("canCaptureCheckpoint when ready_for_review", () => {
      const state = deriveReviewReadiness(makeReadyInput());
      expect(state.permitted.canCaptureCheckpoint).toBe(true);
      expect(state.permitted.canApprove).toBe(false);
    });

    it("canApprove when checkpoint is pending", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "pending", stale: false }),
      }));
      expect(state.permitted.canApprove).toBe(true);
      expect(state.permitted.canRequestChanges).toBe(true);
    });

    it("cannot approve when checkpoint is stale", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "pending", stale: true }),
      }));
      expect(state.permitted.canApprove).toBe(false);
    });

    it("cannot capture when not ready", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        checkEvidence: [makeCheck({ kind: "typecheck", status: "failed" })],
      }));
      expect(state.permitted.canCaptureCheckpoint).toBe(false);
    });

    it("canStartPR is always false (Phase 11 not started)", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "approved", stale: false }),
      }));
      expect(state.permitted.canStartPR).toBe(false);
    });
  });

  // ── Blockers ──

  describe("blockers", () => {
    it("includes check blockers", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "failed", exitCode: 1 }),
          makeCheck({ kind: "test", status: "passed" }),
          makeCheck({ kind: "build", status: "passed" }),
        ],
      }));
      const checkBlockers = state.blockers.filter((b) => b.category === "checks");
      expect(checkBlockers.length).toBeGreaterThan(0);
      expect(checkBlockers[0].reason).toContain("failed");
    });

    it("includes stale blockers", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "passed", stale: true }),
          makeCheck({ kind: "test", status: "passed" }),
          makeCheck({ kind: "build", status: "passed" }),
        ],
      }));
      const staleBlockers = state.blockers.filter((b) => b.category === "stale");
      expect(staleBlockers.length).toBeGreaterThan(0);
    });

    it("includes no mutations blocker", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        mutationEvidence: [],
        checkEvidence: [],
        acceptanceEvidence: [],
      }));
      const mutBlockers = state.blockers.filter((b) => b.category === "mutations");
      expect(mutBlockers.length).toBe(1);
    });
  });

  // ── Purity ──

  describe("purity", () => {
    it("does not mutate input", () => {
      const input = makeReadyInput();
      const inputCopy = JSON.parse(JSON.stringify(input));
      deriveReviewReadiness(input);
      expect(input).toEqual(inputCopy);
    });

    it("produces same output for same input", () => {
      const input = makeReadyInput();
      const state1 = deriveReviewReadiness(input);
      const state2 = deriveReviewReadiness(input);
      expect(state1.readiness).toBe(state2.readiness);
      expect(state1.checks).toEqual(state2.checks);
      expect(state1.acceptance).toEqual(state2.acceptance);
    });
  });
});
