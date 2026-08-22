/**
 * Phase 10.4 — Inspector Consolidation Tests
 *
 * Verifies the 6 permanent inspector panels render correctly
 * with real evidence data and empty/loading states.
 *
 * Phase 10.4 — Studio Control Plane V1
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { PlanPanel } from "../inspector/PlanPanel";
import { ActivityPanel } from "../inspector/ActivityPanel";
import { ChangesPanel } from "../inspector/ChangesPanel";
import { ChecksPanel } from "../inspector/ChecksPanel";
import { AcceptancePanel } from "../inspector/AcceptancePanel";
import { ReviewPanel } from "../inspector/ReviewPanel";
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
    id: `check-${overrides.kind}-${Math.random().toString(36).slice(2, 6)}`, runId: "run-1", projectId: "proj-1", command: `pnpm ${overrides.kind}`,
    cwd: "/workspace", required: true, status: "passed", exitCode: 0,
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    durationMs: 1000, headSha: "abc123", workingTreeDiffHash: "diff-1",
    ...overrides,
  };
}

function makeAcceptance(overrides: Partial<AcceptanceEvidence> = {}): AcceptanceEvidence {
  return {
    id: `acc-1`, runId: "run-1", projectId: "proj-1", criterion: "Feature works",
    required: true, status: "verified", verificationSource: "check_evidence",
    evidenceRefs: ["check-1"], verificationSummary: "Verified by check",
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

describe("Phase 10.4 — Inspector Consolidation", () => {
  describe("PlanPanel", () => {
    it("renders plan and acceptance criteria", () => {
      const { getByTestId } = render(
        <PlanPanel
          plan="Refactor the hero component"
          acceptanceCriteria={["Hero is responsive", "Hero has CTA"]}
          mode="PLAN"
          planApproved={true}
        />,
      );
      expect(getByTestId("plan-panel")).toBeDefined();
      expect(getByTestId("plan-content-panel").textContent).toContain("Refactor the hero");
      expect(getByTestId("plan-criteria-panel").textContent).toContain("Hero is responsive");
    });

    it("shows empty state when no plan", () => {
      const { getByTestId } = render(
        <PlanPanel plan={null} acceptanceCriteria={[]} mode="PLAN" planApproved={false} />,
      );
      expect(getByTestId("plan-panel-empty")).toBeDefined();
    });

    it("shows loading state", () => {
      const { getByTestId } = render(
        <PlanPanel plan={null} acceptanceCriteria={[]} mode="PLAN" planApproved={false} loading={true} />,
      );
      expect(getByTestId("plan-panel-loading")).toBeDefined();
    });
  });

  describe("ActivityPanel", () => {
    it("renders activity items", () => {
      const { getByTestId } = render(
        <ActivityPanel
          items={[
            { id: "1", type: "phase", summary: "Inspecting code", timestamp: Date.now() },
            { id: "2", type: "tool_result", summary: "File saved", timestamp: Date.now(), success: true, durationMs: 500 },
          ]}
          isRunning={false}
        />,
      );
      expect(getByTestId("activity-panel")).toBeDefined();
      expect(getByTestId("activity-item-1")).toBeDefined();
      expect(getByTestId("activity-item-2")).toBeDefined();
    });

    it("shows pending approval", () => {
      const { getByTestId } = render(
        <ActivityPanel
          items={[]}
          isRunning={true}
          pendingApproval={{ toolId: "deploy", reason: "Deploy requires approval" }}
        />,
      );
      expect(getByTestId("activity-pending-approval")).toBeDefined();
      expect(getByTestId("activity-pending-approval").textContent).toContain("Deploy requires approval");
    });

    it("shows running indicator", () => {
      const { getByTestId } = render(
        <ActivityPanel items={[]} isRunning={true} />,
      );
      expect(getByTestId("activity-running-indicator")).toBeDefined();
    });

    it("shows empty state", () => {
      const { getByTestId } = render(
        <ActivityPanel items={[]} isRunning={false} />,
      );
      expect(getByTestId("activity-panel-empty")).toBeDefined();
    });
  });

  describe("ChangesPanel", () => {
    it("renders changed files with summary", () => {
      const { getByTestId } = render(
        <ChangesPanel
          changes={{ added: 1, modified: 1, deleted: 0, total: 2, paths: ["src/new.ts", "src/old.ts"] }}
          workingTreeDirty={true}
        />,
      );
      expect(getByTestId("changes-panel")).toBeDefined();
      expect(getByTestId("changes-summary-panel").textContent).toContain("1 added");
      expect(getByTestId("changes-summary-panel").textContent).toContain("1 modified");
      expect(getByTestId("changes-file-src/new.ts")).toBeDefined();
      expect(getByTestId("changes-file-src/old.ts")).toBeDefined();
    });

    it("calls onFileClick when file is clicked", () => {
      const onClick = vi.fn();
      const { getByTestId } = render(
        <ChangesPanel
          changes={{ added: 1, modified: 0, deleted: 0, total: 1, paths: ["src/foo.ts"] }}
          workingTreeDirty={false}
          onFileClick={onClick}
        />,
      );
      fireEvent.click(getByTestId("changes-file-src/foo.ts"));
      expect(onClick).toHaveBeenCalledWith("src/foo.ts");
    });

    it("shows empty state", () => {
      const { getByTestId } = render(
        <ChangesPanel changes={{ added: 0, modified: 0, deleted: 0, total: 0, paths: [] }} workingTreeDirty={false} />,
      );
      expect(getByTestId("changes-panel-empty")).toBeDefined();
    });
  });

  describe("ChecksPanel", () => {
    it("renders checks with summary", () => {
      const { getByTestId } = render(
        <ChecksPanel
          summary={{ total: 3, passed: 2, failed: 1, skipped: 0, running: 0, stale: 0, failedRequired: 1, skippedRequired: 0 }}
          checks={[
            makeCheck({ kind: "typecheck", status: "passed" }),
            makeCheck({ kind: "test", status: "passed" }),
            makeCheck({ kind: "build", status: "failed", failureReason: "Build error" }),
          ]}
        />,
      );
      expect(getByTestId("checks-panel")).toBeDefined();
      expect(getByTestId("checks-summary-panel").textContent).toContain("2 passed");
      expect(getByTestId("checks-summary-panel").textContent).toContain("1 failed");
      expect(getByTestId("check-item-typecheck")).toBeDefined();
      expect(getByTestId("check-item-build").textContent).toContain("Build error");
    });

    it("shows empty state", () => {
      const { getByTestId } = render(
        <ChecksPanel summary={{ total: 0, passed: 0, failed: 0, skipped: 0, running: 0, stale: 0, failedRequired: 0, skippedRequired: 0 }} checks={[]} />,
      );
      expect(getByTestId("checks-panel-empty")).toBeDefined();
    });

    it("calls onRerun when rerun button is clicked", () => {
      const onRerun = vi.fn();
      const check = makeCheck({ kind: "typecheck", status: "passed" });
      const { getByTestId } = render(
        <ChecksPanel
          summary={{ total: 1, passed: 1, failed: 0, skipped: 0, running: 0, stale: 0, failedRequired: 0, skippedRequired: 0 }}
          checks={[check]}
          onRerun={onRerun}
        />,
      );
      fireEvent.click(getByTestId("check-rerun-typecheck"));
      expect(onRerun).toHaveBeenCalledWith(check.id);
    });
  });

  describe("AcceptancePanel", () => {
    it("renders acceptance evidence with summary", () => {
      const { getByTestId } = render(
        <AcceptancePanel
          summary={{ total: 2, verified: 1, failed: 1, skipped: 0, stale: 0, requiredPending: 1 }}
          evidence={[
            makeAcceptance({ id: "acc-1", criterion: "Feature A works", status: "verified" }),
            makeAcceptance({ id: "acc-2", criterion: "Feature B works", status: "failed", failureReason: "Not met" }),
          ]}
        />,
      );
      expect(getByTestId("acceptance-panel")).toBeDefined();
      expect(getByTestId("acceptance-summary-panel").textContent).toContain("1 verified");
      expect(getByTestId("acceptance-summary-panel").textContent).toContain("1 failed");
      expect(getByTestId("acceptance-item-acc-1")).toBeDefined();
      expect(getByTestId("acceptance-item-acc-2").textContent).toContain("Not met");
    });

    it("shows empty state", () => {
      const { getByTestId } = render(
        <AcceptancePanel summary={{ total: 0, verified: 0, failed: 0, skipped: 0, stale: 0, requiredPending: 0 }} evidence={[]} />,
      );
      expect(getByTestId("acceptance-panel-empty")).toBeDefined();
    });
  });

  describe("ReviewPanel", () => {
    it("renders ready_for_review state with capture button", () => {
      const state = deriveReviewReadiness(makeReadyInput());
      const { getByTestId } = render(
        <ReviewPanel state={state} onCaptureCheckpoint={() => {}} />,
      );
      expect(getByTestId("review-panel")).toBeDefined();
      expect(getByTestId("review-status-panel").textContent).toContain("Ready for Review");
      expect(getByTestId("review-capture-btn")).toBeDefined();
    });

    it("renders approved state", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "approved", stale: false }),
      }));
      const { getByTestId } = render(<ReviewPanel state={state} />);
      expect(getByTestId("review-status-panel").textContent).toContain("Approved");
    });

    it("renders blockers when blocked", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        checkEvidence: [makeCheck({ kind: "typecheck", status: "failed" })],
      }));
      const { getByTestId } = render(<ReviewPanel state={state} />);
      expect(getByTestId("review-blockers-panel")).toBeDefined();
    });

    it("renders provenance", () => {
      const state = deriveReviewReadiness(makeReadyInput());
      const { getByTestId } = render(<ReviewPanel state={state} />);
      expect(getByTestId("review-provenance-panel")).toBeDefined();
      expect(getByTestId("review-provenance-panel").textContent).toContain("abc123");
    });

    it("shows approve button when checkpoint is pending", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "pending", stale: false }),
      }));
      const { getByTestId } = render(
        <ReviewPanel state={state} onApprove={() => {}} onRequestChanges={() => {}} />,
      );
      expect(getByTestId("review-approve-btn")).toBeDefined();
      expect(getByTestId("review-request-changes-btn")).toBeDefined();
    });

    it("does not show approve button when checkpoint is stale", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "pending", stale: true }),
      }));
      const { queryByTestId } = render(
        <ReviewPanel state={state} onApprove={() => {}} onRequestChanges={() => {}} />,
      );
      expect(queryByTestId("review-approve-btn")).toBeNull();
    });

    it("calls onApprove when approve button is clicked", () => {
      const onApprove = vi.fn();
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "pending", stale: false }),
      }));
      const { getByTestId } = render(<ReviewPanel state={state} onApprove={onApprove} />);
      fireEvent.click(getByTestId("review-approve-btn"));
      expect(onApprove).toHaveBeenCalled();
    });

    it("shows empty state when not started", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        mutationEvidence: [],
        checkEvidence: [],
        acceptanceEvidence: [],
      }));
      const { getByTestId } = render(<ReviewPanel state={state} />);
      expect(getByTestId("review-panel-empty")).toBeDefined();
    });

    it("renders checkpoint with reviewer info", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({
          decision: "approved",
          reviewerUserId: "reviewer-1",
          reviewedAt: new Date().toISOString(),
          reviewComments: "Looks good",
        }),
      }));
      const { getByTestId } = render(<ReviewPanel state={state} />);
      expect(getByTestId("review-checkpoint-panel").textContent).toContain("reviewer-1");
      expect(getByTestId("review-checkpoint-panel").textContent).toContain("Looks good");
    });
  });
});
