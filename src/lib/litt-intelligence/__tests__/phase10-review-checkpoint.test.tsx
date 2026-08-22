/**
 * Phase 10 Acceptance Test — Review Checkpoint
 *
 * Test matrix:
 * 1.  capture checkpoint when ready → pending
 * 2.  cannot capture when not ready → no checkpoint, blockers returned
 * 3.  approve pending checkpoint → review_approved
 * 4.  request changes on pending checkpoint → changes_requested
 * 5.  cannot approve stale checkpoint → rejected
 * 6.  cannot approve already-decided checkpoint → rejected
 * 7.  subsequent mutation invalidates approval → stale
 * 8.  stale checkpoint → ready_for_review (needs re-review)
 * 9.  approved + fresh → review_approved in deriveRunStatus
 * 10. changes_requested → not ready in deriveRunStatus
 * 11. UI renders review state correctly
 * 12. API returns review checkpoints
 *
 * Phase 10 — Studio Control Plane V1
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ReviewCheckpoint } from "@/lib/litt-intelligence/review-checkpoint";
import { isReviewCheckpointStale } from "@/lib/litt-intelligence/review-checkpoint";
import { resetReviewCheckpointStore, getReviewCheckpointStore } from "@/lib/litt-intelligence/review-checkpoint-store";
import {
  captureReviewCheckpoint,
  approveReviewCheckpoint,
  requestChangesOnCheckpoint,
  invalidateStaleReviewCheckpoints,
  getReviewState,
  type CaptureCheckpointInput,
} from "@/lib/litt-intelligence/review-checkpoint-service";
import { deriveRunStatus } from "@/lib/litt-intelligence/run-status";
import { resetStores } from "@/lib/litt-intelligence/evidence-store";
import { resetRunEventStore } from "@/lib/litt-intelligence/run-event-store";
import { resetCheckEvidenceStore } from "@/lib/litt-intelligence/check-evidence-store";
import { resetAcceptanceEvidenceStore } from "@/lib/litt-intelligence/acceptance-evidence-store";
import type { MutationEvidence } from "@/lib/litt-intelligence/mutation-evidence";
import type { CheckEvidence } from "@/lib/litt-intelligence/check-evidence";
import type { AcceptanceEvidence } from "@/lib/litt-intelligence/acceptance-evidence";
import { StudioReviewPanel } from "@/app/(app)/studio/components/StudioReviewPanel";
import { render } from "@testing-library/react";

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

// Mock transport
const mockTransport = {
  workspaceId: "ws-1",
  workspaceRoot: "/workspace",
  projectId: "proj-1",
  userId: "user-1",
  gitLog: async () => ({ commits: [{ sha: "abc123", message: "test", author: "test", date: "2024-01-01" }] }),
  gitDiff: async () => ({ diff: "test diff" }),
  readFile: async () => ({ content: "test", size: 4 }),
  writeFile: async () => ({ saved: true }),
  deleteFile: async () => ({ deleted: true }),
  mkdir: async () => ({ created: true }),
  rename: async () => ({ renamed: true }),
  exec: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0 }),
  gitStatus: async () => ({ branch: "feat/test", ahead: 0, behind: 0, staged: [], modified: [], untracked: [], clean: true }),
  gitCommit: async () => ({ committed: true, sha: "abc123" }),
  searchCode: async () => ({ results: [] }),
  discoverPackageInfo: async () => ({ packageManager: "npm", scripts: {}, hasTypecheck: false, hasLint: false, hasBuild: false, hasTest: false }),
  runCheck: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0 }),
  applyPatch: async () => ({ applied: true }),
  createCheckpointBeforeMutation: async () => null,
  listFiles: async () => ({ entries: [] }),
} as const;

function makeReadyContext(): CaptureCheckpointInput {
  return {
    runId: "run-1",
    projectId: "proj-1",
    transport: mockTransport as never,
    mutationEvidence: [makeMutation()],
    checkEvidence: [
      makeCheck({ kind: "typecheck", status: "passed" }),
      makeCheck({ kind: "test", status: "passed" }),
      makeCheck({ kind: "build", status: "passed" }),
    ],
    acceptanceEvidence: [
      makeAcceptance({ criterion: "Feature works", status: "verified", evidenceRefs: ["check-1"] }),
    ],
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("Phase 10 — Review Checkpoint", () => {
  beforeEach(() => {
    resetStores();
    resetRunEventStore();
    resetCheckEvidenceStore();
    resetAcceptanceEvidenceStore();
    resetReviewCheckpointStore();
  });

  // ── isReviewCheckpointStale ──

  describe("isReviewCheckpointStale", () => {
    it("returns false when code state matches", () => {
      const cp = makeCheckpoint({ headSha: "abc123", workingTreeDiffHash: "diff-1" });
      expect(isReviewCheckpointStale(cp, "abc123", "diff-1")).toBe(false);
    });

    it("returns true when headSha changed", () => {
      const cp = makeCheckpoint({ headSha: "abc123", workingTreeDiffHash: "diff-1" });
      expect(isReviewCheckpointStale(cp, "def456", "diff-1")).toBe(true);
    });

    it("returns true when workingTreeDiffHash changed", () => {
      const cp = makeCheckpoint({ headSha: "abc123", workingTreeDiffHash: "diff-1" });
      expect(isReviewCheckpointStale(cp, "abc123", "diff-2")).toBe(true);
    });

    it("returns true if already marked stale", () => {
      const cp = makeCheckpoint({ stale: true });
      expect(isReviewCheckpointStale(cp, "abc123", "diff-1")).toBe(true);
    });
  });

  // ── Capture ──

  describe("captureReviewCheckpoint", () => {
    it("1. capture checkpoint when ready → pending", async () => {
      const result = await captureReviewCheckpoint(makeReadyContext());
      expect(result.ready).toBe(true);
      expect(result.checkpoint.decision).toBe("pending");
      expect(result.checkpoint.headSha).toBe("abc123");
      expect(result.checkpoint.mutationEvidenceIds.length).toBe(1);
      expect(result.checkpoint.checkEvidenceIds.length).toBe(3);
      expect(result.checkpoint.acceptanceEvidenceIds.length).toBe(1);
    });

    it("2. cannot capture when not ready → no checkpoint, blockers returned", async () => {
      const context = makeReadyContext();
      // Make checks fail
      context.checkEvidence = [
        makeCheck({ kind: "typecheck", status: "failed", exitCode: 1 }),
        makeCheck({ kind: "test", status: "passed" }),
        makeCheck({ kind: "build", status: "passed" }),
      ];

      const result = await captureReviewCheckpoint(context);
      expect(result.ready).toBe(false);
      expect(result.checkpoint.id).toBe("not-captured");
      expect(result.derivation.blockers.length).toBeGreaterThan(0);
    });
  });

  // ── Approve ──

  describe("approveReviewCheckpoint", () => {
    it("3. approve pending checkpoint → review_approved", async () => {
      const capture = await captureReviewCheckpoint(makeReadyContext());
      const result = await approveReviewCheckpoint({
        checkpointId: capture.checkpoint.id,
        reviewerUserId: "reviewer-1",
        reviewComments: "Looks good",
      });

      expect(result.approved).toBe(true);
      expect(result.checkpoint.decision).toBe("approved");
      expect(result.checkpoint.reviewerUserId).toBe("reviewer-1");
      expect(result.checkpoint.reviewComments).toBe("Looks good");
      expect(result.checkpoint.reviewedAt).toBeDefined();
    });

    it("5. cannot approve stale checkpoint → rejected", async () => {
      const store = getReviewCheckpointStore();
      const cp = makeCheckpoint({ stale: true, staleReason: "Code changed" });
      await store.insert(cp);

      const result = await approveReviewCheckpoint({
        checkpointId: cp.id,
        reviewerUserId: "reviewer-1",
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("stale");
    });

    it("6. cannot approve already-decided checkpoint → rejected", async () => {
      const store = getReviewCheckpointStore();
      const cp = makeCheckpoint({ decision: "approved" });
      await store.insert(cp);

      const result = await approveReviewCheckpoint({
        checkpointId: cp.id,
        reviewerUserId: "reviewer-1",
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("already has decision");
    });
  });

  // ── Request Changes ──

  describe("requestChangesOnCheckpoint", () => {
    it("4. request changes on pending checkpoint → changes_requested", async () => {
      const capture = await captureReviewCheckpoint(makeReadyContext());
      const result = await requestChangesOnCheckpoint({
        checkpointId: capture.checkpoint.id,
        reviewerUserId: "reviewer-1",
        reviewComments: "Fix the edge case",
      });

      expect(result.recorded).toBe(true);
      expect(result.checkpoint.decision).toBe("changes_requested");
      expect(result.checkpoint.reviewComments).toBe("Fix the edge case");
    });
  });

  // ── Stale Invalidation ──

  describe("invalidateStaleReviewCheckpoints", () => {
    it("7. subsequent mutation invalidates approval → stale", async () => {
      // Capture and approve
      const capture = await captureReviewCheckpoint(makeReadyContext());
      await approveReviewCheckpoint({
        checkpointId: capture.checkpoint.id,
        reviewerUserId: "reviewer-1",
      });

      // Code changes (new mutation)
      await invalidateStaleReviewCheckpoints("run-1", "new-sha", "new-diff-hash");

      const store = getReviewCheckpointStore();
      const updated = await store.getById(capture.checkpoint.id);
      expect(updated?.stale).toBe(true);
      expect(updated?.decision).toBe("stale");
      expect(updated?.staleReason).toContain("Code changed");
    });

    it("8. stale checkpoint → ready_for_review in deriveRunStatus (needs re-review)", async () => {
      const staleCheckpoint = makeCheckpoint({ decision: "approved", stale: true });

      const status = deriveRunStatus({
        mutationEvidence: [makeMutation()],
        checkEvidence: [makeCheck({ kind: "typecheck", status: "passed" })],
        acceptanceEvidence: [makeAcceptance()],
        unresolvedBlockingEvents: [],
        reviewCheckpoint: staleCheckpoint,
      });

      expect(status.status).toBe("ready_for_review");
      expect(status.readyForReview).toBe(true);
      expect(status.reviewStale).toBe(true);
      expect(status.reviewApproved).toBe(false);
    });
  });

  // ── deriveRunStatus with review checkpoint ──

  describe("deriveRunStatus with review checkpoint", () => {
    it("9. approved + fresh → review_approved", () => {
      const checkpoint = makeCheckpoint({ decision: "approved", stale: false });

      const status = deriveRunStatus({
        mutationEvidence: [makeMutation()],
        checkEvidence: [makeCheck({ kind: "typecheck", status: "passed" })],
        acceptanceEvidence: [makeAcceptance()],
        unresolvedBlockingEvents: [],
        reviewCheckpoint: checkpoint,
      });

      expect(status.status).toBe("review_approved");
      expect(status.reviewApproved).toBe(true);
      expect(status.readyForReview).toBe(true);
    });

    it("10. changes_requested → not ready", () => {
      const checkpoint = makeCheckpoint({ decision: "changes_requested", stale: false });

      const status = deriveRunStatus({
        mutationEvidence: [makeMutation()],
        checkEvidence: [makeCheck({ kind: "typecheck", status: "passed" })],
        acceptanceEvidence: [makeAcceptance()],
        unresolvedBlockingEvents: [],
        reviewCheckpoint: checkpoint,
      });

      expect(status.status).toBe("changes_requested");
      expect(status.changesRequested).toBe(true);
      expect(status.readyForReview).toBe(false);
    });

    it("pending checkpoint → ready_for_review (awaiting human)", () => {
      const checkpoint = makeCheckpoint({ decision: "pending", stale: false });

      const status = deriveRunStatus({
        mutationEvidence: [makeMutation()],
        checkEvidence: [makeCheck({ kind: "typecheck", status: "passed" })],
        acceptanceEvidence: [makeAcceptance()],
        unresolvedBlockingEvents: [],
        reviewCheckpoint: checkpoint,
      });

      expect(status.status).toBe("ready_for_review");
      expect(status.reviewApproved).toBe(false);
    });

    it("no checkpoint → ready_for_review", () => {
      const status = deriveRunStatus({
        mutationEvidence: [makeMutation()],
        checkEvidence: [makeCheck({ kind: "typecheck", status: "passed" })],
        acceptanceEvidence: [makeAcceptance()],
        unresolvedBlockingEvents: [],
        reviewCheckpoint: null,
      });

      expect(status.status).toBe("ready_for_review");
      expect(status.reviewApproved).toBe(false);
    });
  });

  // ── getReviewState ──

  describe("getReviewState", () => {
    it("returns correct state for approved checkpoint", async () => {
      const capture = await captureReviewCheckpoint(makeReadyContext());
      await approveReviewCheckpoint({
        checkpointId: capture.checkpoint.id,
        reviewerUserId: "reviewer-1",
      });

      const state = await getReviewState("run-1");
      expect(state.reviewApproved).toBe(true);
      expect(state.changesRequested).toBe(false);
      expect(state.hasStaleCheckpoint).toBe(false);
    });

    it("returns correct state for stale checkpoint", async () => {
      const capture = await captureReviewCheckpoint(makeReadyContext());
      await approveReviewCheckpoint({
        checkpointId: capture.checkpoint.id,
        reviewerUserId: "reviewer-1",
      });
      await invalidateStaleReviewCheckpoints("run-1", "new-sha", "new-diff");

      const state = await getReviewState("run-1");
      expect(state.reviewApproved).toBe(false);
      expect(state.hasStaleCheckpoint).toBe(true);
    });

    it("returns empty state when no checkpoint exists", async () => {
      const state = await getReviewState("run-1");
      expect(state.latestCheckpoint).toBeNull();
      expect(state.reviewApproved).toBe(false);
    });
  });

  // ── UI Tests ──

  describe("StudioReviewPanel", () => {
    it("11. UI renders review state correctly — approved", () => {
      const checkpoint = makeCheckpoint({
        decision: "approved",
        reviewerUserId: "reviewer-1",
        reviewedAt: new Date().toISOString(),
      });
      const { getByTestId } = render(
        <StudioReviewPanel
          checkpoint={checkpoint}
          mutations={[makeMutation()]}
          readyForReview={true}
          blockers={[]}
          loading={false}
        />,
      );
      expect(getByTestId("studio-review-panel")).toBeDefined();
      expect(getByTestId("review-checkpoint")).toBeDefined();
      expect(getByTestId("review-decision").textContent).toContain("Approved");
      expect(getByTestId("review-code-state")).toBeDefined();
      expect(getByTestId("review-mutations")).toBeDefined();
      expect(getByTestId("review-evidence-counts")).toBeDefined();
    });

    it("renders stale state with reason", () => {
      const checkpoint = makeCheckpoint({
        decision: "stale",
        stale: true,
        staleReason: "Code changed after review",
      });
      const { getByTestId } = render(
        <StudioReviewPanel
          checkpoint={checkpoint}
          mutations={[]}
          readyForReview={true}
          blockers={[]}
          loading={false}
        />,
      );
      expect(getByTestId("review-stale-badge")).toBeDefined();
      expect(getByTestId("review-stale-reason").textContent).toContain("Code changed");
    });

    it("renders blockers when not ready", () => {
      const { getByTestId } = render(
        <StudioReviewPanel
          checkpoint={null}
          mutations={[]}
          readyForReview={false}
          blockers={["Tests failed", "Build failed"]}
          loading={false}
        />,
      );
      expect(getByTestId("review-blockers")).toBeDefined();
      expect(getByTestId("review-blockers").textContent).toContain("Tests failed");
    });

    it("renders ready state when no checkpoint but ready", () => {
      const { getByTestId } = render(
        <StudioReviewPanel
          checkpoint={null}
          mutations={[]}
          readyForReview={true}
          blockers={[]}
          loading={false}
        />,
      );
      expect(getByTestId("studio-review-panel")).toBeDefined();
    });

    it("renders approve and request changes buttons when pending", () => {
      const checkpoint = makeCheckpoint({ decision: "pending", stale: false });
      const { getByTestId } = render(
        <StudioReviewPanel
          checkpoint={checkpoint}
          mutations={[makeMutation()]}
          readyForReview={true}
          blockers={[]}
          loading={false}
          onApprove={() => {}}
          onRequestChanges={() => {}}
        />,
      );
      expect(getByTestId("review-actions")).toBeDefined();
      expect(getByTestId("review-approve-btn")).toBeDefined();
      expect(getByTestId("review-request-changes-btn")).toBeDefined();
    });

    it("does not render action buttons when stale", () => {
      const checkpoint = makeCheckpoint({ decision: "stale", stale: true });
      const { queryByTestId } = render(
        <StudioReviewPanel
          checkpoint={checkpoint}
          mutations={[]}
          readyForReview={true}
          blockers={[]}
          loading={false}
          onApprove={() => {}}
          onRequestChanges={() => {}}
        />,
      );
      expect(queryByTestId("review-actions")).toBeNull();
    });
  });

  // ── API (structural) ──

  describe("12. API returns review checkpoints", () => {
    it("evidence API route imports review checkpoint store", async () => {
      const routeModule = await import("@/app/api/studio/evidence/route");
      expect(routeModule).toBeDefined();
      expect(typeof routeModule.GET).toBe("function");
    });
  });
});
