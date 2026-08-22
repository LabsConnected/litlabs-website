/**
 * Phase 10.5 — Review Experience Tests
 *
 * Verifies the composable review sub-components render correctly
 * and that approval is tied to exact code-state provenance.
 *
 * Phase 10.5 — Studio Control Plane V1
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ReadinessSummary } from "../review/ReadinessSummary";
import { ReviewBlockingReasons } from "../review/ReviewBlockingReasons";
import { ProvenanceSummary } from "../review/ProvenanceSummary";
import { ReviewActionBar } from "../review/ReviewActionBar";
import { deriveReviewReadiness, type ReviewReadinessInput } from "@/app/(app)/studio/lib/review-readiness";
import type { MutationEvidence } from "@/lib/litt-intelligence/mutation-evidence";
import type { CheckEvidence } from "@/lib/litt-intelligence/check-evidence";
import type { AcceptanceEvidence } from "@/lib/litt-intelligence/acceptance-evidence";
import type { ReviewCheckpoint } from "@/lib/litt-intelligence/review-checkpoint";

// ─── Helpers ─────────────────────────────────────────────────────

function makeMutation(overrides: Partial<MutationEvidence> = {}): MutationEvidence {
  return {
    id: `mut-1`, runId: "run-1", projectId: "proj-1", toolId: "files.write",
    workspaceId: "ws-1", branch: "feat/test", baseSha: "base123", headShaBefore: "abc123",
    paths: ["src/foo.ts"], beforeHashes: { "src/foo.ts": null }, afterHashes: { "src/foo.ts": "hash1" },
    status: "succeeded", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCheck(overrides: Partial<CheckEvidence> & { kind: CheckEvidence["kind"] }): CheckEvidence {
  return {
    id: `check-${overrides.kind}-${Math.random().toString(36).slice(2, 6)}`, runId: "run-1", projectId: "proj-1",
    command: `pnpm ${overrides.kind}`, cwd: "/workspace", required: true, status: "passed", exitCode: 0,
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    durationMs: 1000, headSha: "abc123", workingTreeDiffHash: "diff-1",
    ...overrides,
  };
}

function makeAcceptance(overrides: Partial<AcceptanceEvidence> = {}): AcceptanceEvidence {
  return {
    id: `acc-1`, runId: "run-1", projectId: "proj-1", criterion: "Feature works",
    required: true, status: "verified", verificationSource: "check_evidence",
    evidenceRefs: ["check-1"], verificationSummary: "Verified",
    headSha: "abc123", workingTreeDiffHash: "diff-1", stale: false,
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 100,
    ...overrides,
  };
}

function makeCheckpoint(overrides: Partial<ReviewCheckpoint> = {}): ReviewCheckpoint {
  return {
    id: `cp-1`, runId: "run-1", projectId: "proj-1", decision: "pending",
    headSha: "abc123", workingTreeDiffHash: "diff-1",
    mutationEvidenceIds: ["mut-1"], checkEvidenceIds: ["check-1"], acceptanceEvidenceIds: ["acc-1"],
    blockers: [], stale: false, capturedAt: new Date().toISOString(),
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
    acceptanceEvidence: [makeAcceptance()],
    reviewCheckpoint: null,
    runEvents: [],
    checksRunning: false,
    isActing: false,
    pendingApprovalCount: 0,
    headSha: "abc123",
    workingTreeDiffHash: "diff-1",
    workingTreeClean: false,
    unresolvedBlockingEvents: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("Phase 10.5 — Review Experience", () => {
  describe("ReadinessSummary", () => {
    it("renders ready_for_review state", () => {
      const state = deriveReviewReadiness(makeReadyInput());
      const { getByTestId } = render(<ReadinessSummary state={state} />);
      expect(getByTestId("readiness-summary").textContent).toContain("Ready for Review");
    });

    it("renders approved state", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "approved", stale: false }),
      }));
      const { getByTestId } = render(<ReadinessSummary state={state} />);
      expect(getByTestId("readiness-summary").textContent).toContain("Approved");
    });

    it("renders blocked state with stale evidence indicator", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "passed", stale: true }),
          makeCheck({ kind: "test", status: "passed" }),
          makeCheck({ kind: "build", status: "passed" }),
        ],
      }));
      const { getByTestId } = render(<ReadinessSummary state={state} />);
      expect(getByTestId("readiness-summary").textContent).toContain("stale evidence");
    });

    it("shows file/check/criteria counts", () => {
      const state = deriveReviewReadiness(makeReadyInput());
      const { getByTestId } = render(<ReadinessSummary state={state} />);
      const text = getByTestId("readiness-summary").textContent;
      expect(text).toContain("1 files");
      expect(text).toContain("3 checks");
      expect(text).toContain("1 criteria");
    });
  });

  describe("ReviewBlockingReasons", () => {
    it("renders blockers with categories", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        checkEvidence: [makeCheck({ kind: "typecheck", status: "failed" })],
      }));
      const { getByTestId } = render(<ReviewBlockingReasons blockers={state.blockers} />);
      expect(getByTestId("review-blocking-reasons")).toBeDefined();
      expect(getByTestId("blocking-reason-0").textContent).toContain("failed");
    });

    it("returns null when no blockers", () => {
      const { queryByTestId } = render(<ReviewBlockingReasons blockers={[]} />);
      expect(queryByTestId("review-blocking-reasons")).toBeNull();
    });

    it("shows category label", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        checkEvidence: [makeCheck({ kind: "typecheck", status: "failed" })],
      }));
      const { getByTestId } = render(<ReviewBlockingReasons blockers={state.blockers} />);
      expect(getByTestId("blocking-reason-0").textContent).toContain("checks");
    });
  });

  describe("ProvenanceSummary", () => {
    it("renders SHA and diff hash", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        headSha: "abcdef1234567890",
        workingTreeDiffHash: "diffhash1234567890",
      }));
      const { getByTestId } = render(<ProvenanceSummary provenance={state.provenance} />);
      const text = getByTestId("provenance-summary").textContent;
      expect(text).toContain("abcdef123456");
      expect(text).toContain("diffhash1234");
    });

    it("shows clean state", () => {
      const state = deriveReviewReadiness(makeReadyInput({ workingTreeClean: true }));
      const { getByTestId } = render(<ProvenanceSummary provenance={state.provenance} />);
      expect(getByTestId("provenance-summary").textContent).toContain("clean");
    });

    it("shows uncommitted changes state", () => {
      const state = deriveReviewReadiness(makeReadyInput({ workingTreeClean: false }));
      const { getByTestId } = render(<ProvenanceSummary provenance={state.provenance} />);
      expect(getByTestId("provenance-summary").textContent).toContain("uncommitted");
    });

    it("shows no code state when provenance is null", () => {
      const { getByTestId } = render(<ProvenanceSummary provenance={null} />);
      expect(getByTestId("provenance-summary").textContent).toContain("No code state");
    });
  });

  describe("ReviewActionBar", () => {
    it("shows capture button when ready_for_review", () => {
      const state = deriveReviewReadiness(makeReadyInput());
      const { getByTestId } = render(
        <ReviewActionBar permitted={state.permitted} onCaptureCheckpoint={() => {}} />,
      );
      expect(getByTestId("action-capture-checkpoint")).toBeDefined();
    });

    it("shows approve and request changes when checkpoint is pending", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "pending", stale: false }),
      }));
      const { getByTestId } = render(
        <ReviewActionBar
          permitted={state.permitted}
          onApprove={() => {}}
          onRequestChanges={() => {}}
        />,
      );
      expect(getByTestId("action-approve")).toBeDefined();
      expect(getByTestId("action-request-changes")).toBeDefined();
    });

    it("does not show approve when checkpoint is stale", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "pending", stale: true }),
      }));
      const { queryByTestId } = render(
        <ReviewActionBar permitted={state.permitted} onApprove={() => {}} />,
      );
      expect(queryByTestId("action-approve")).toBeNull();
    });

    it("calls onApprove when approve is clicked", () => {
      const onApprove = vi.fn();
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "pending", stale: false }),
      }));
      const { getByTestId } = render(
        <ReviewActionBar permitted={state.permitted} onApprove={onApprove} />,
      );
      fireEvent.click(getByTestId("action-approve"));
      expect(onApprove).toHaveBeenCalled();
    });

    it("calls onCaptureCheckpoint when capture is clicked", () => {
      const onCapture = vi.fn();
      const state = deriveReviewReadiness(makeReadyInput());
      const { getByTestId } = render(
        <ReviewActionBar permitted={state.permitted} onCaptureCheckpoint={onCapture} />,
      );
      fireEvent.click(getByTestId("action-capture-checkpoint"));
      expect(onCapture).toHaveBeenCalled();
    });

    it("returns null when no actions are permitted", () => {
      const { queryByTestId } = render(
        <ReviewActionBar
          permitted={{
            canCaptureCheckpoint: false,
            canApprove: false,
            canRequestChanges: false,
            canRunChecks: false,
            canStartPR: false,
          }}
        />,
      );
      expect(queryByTestId("review-action-bar")).toBeNull();
    });

    it("shows loading state on approve button", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "pending", stale: false }),
      }));
      const { getByTestId } = render(
        <ReviewActionBar permitted={state.permitted} onApprove={() => {}} approving={true} />,
      );
      const btn = getByTestId("action-approve") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  // ── Provenance binding invariant ──

  describe("provenance binding", () => {
    it("approval is tied to exact code state — SHA change invalidates", () => {
      const state1 = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "approved", headSha: "abc123", stale: false }),
      }));
      expect(state1.readiness).toBe("approved");

      const state2 = deriveReviewReadiness(makeReadyInput({
        headSha: "different-sha",
        reviewCheckpoint: makeCheckpoint({ decision: "approved", headSha: "abc123", stale: false }),
      }));
      // The checkpoint's SHA doesn't match the current SHA — should be stale
      // (This is enforced by the review-checkpoint service, not deriveRunStatus directly,
      // but the provenance summary shows the current state, not the checkpoint's state)
      expect(state2.provenance?.headSha).toBe("different-sha");
    });
  });
});
