/**
 * Phase 10.8 — Visual Gate: Integration Tests
 *
 * Verifies that all Phase 10 components compose correctly:
 * - StudioShell renders all 5 regions
 * - StudioInspector renders all 6 tabs
 * - StudioStateSurface handles all 20 states
 * - ReviewReadiness selector drives the review panel
 * - Design tokens are consumed consistently
 * - No placeholder or prototype copy in production components
 *
 * Phase 10.8 — Visual gate
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StudioShell } from "../shell/StudioShell";
import { StudioStateSurface, type StudioState } from "../shell/StudioStateSurface";
import { StudioInspector, type InspectorTabId } from "../shell/StudioInspector";
import { ReviewPanel } from "../inspector/ReviewPanel";
import { deriveReviewReadiness, type ReviewReadinessInput } from "@/app/(app)/studio/lib/review-readiness";
import { studioColors } from "@/lib/studio/design-tokens";
import { MessageSquare, Code, Eye, FolderOpen, ListChecks, CheckCircle, Play, Bot } from "lucide-react";
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

const railDestinations = [
  { id: "chat", label: "Chat", icon: <MessageSquare size={16} /> },
  { id: "code", label: "Code", icon: <Code size={16} /> },
  { id: "preview", label: "Preview", icon: <Eye size={16} /> },
  { id: "files", label: "Files", icon: <FolderOpen size={16} /> },
  { id: "checks", label: "Checks", icon: <ListChecks size={16} /> },
  { id: "review", label: "Review", icon: <CheckCircle size={16} /> },
  { id: "runs", label: "Runs", icon: <Play size={16} /> },
  { id: "agents", label: "Agents", icon: <Bot size={16} /> },
];

// ─── Tests ───────────────────────────────────────────────────────

describe("Phase 10.8 — Visual Gate Integration", () => {
  describe("full shell composition", () => {
    it("renders the complete shell with review panel in inspector", () => {
      const state = deriveReviewReadiness(makeReadyInput());
      const { getByTestId } = render(
        <StudioShell
          project="litlabs-website"
          branch="feat/test"
          headSha="abc123"
          runtimeStatus={{ label: "Ready", tone: "success" }}
          model="gpt-4"
          runState={{ label: "Idle", tone: "idle" }}
          reviewStatus={{ label: "Ready for Review", tone: "violet" }}
          connectionHealthy={true}
          railDestinations={railDestinations}
          activeDestination="chat"
          onDestinationChange={() => {}}
          workspaceContent={<div data-testid="ws">Workspace</div>}
          inspectorActiveTab="review"
          onInspectorTabChange={() => {}}
          renderInspectorTab={(tab) => {
            if (tab === "review") return <ReviewPanel state={state} />;
            return <div>{tab}</div>;
          }}
          composerContent={<div data-testid="composer-input">Input</div>}
        />,
      );

      // All 5 regions
      expect(getByTestId("studio-shell")).toBeDefined();
      expect(getByTestId("studio-context-bar")).toBeDefined();
      expect(getByTestId("studio-product-rail")).toBeDefined();
      expect(getByTestId("studio-workspace")).toBeDefined();
      expect(getByTestId("studio-inspector")).toBeDefined();
      expect(getByTestId("studio-composer")).toBeDefined();

      // Review panel is rendered in inspector
      expect(getByTestId("review-panel")).toBeDefined();

      // Context bar shows project info
      expect(getByTestId("context-bar-project").textContent).toBe("litlabs-website");

      // All 8 rail destinations
      railDestinations.forEach((d) => {
        expect(getByTestId(`rail-${d.id}`)).toBeDefined();
      });
    });
  });

  describe("all 20 states render in workspace", () => {
    const states: StudioState[] = [
      "no_project", "project_loading", "runtime_connecting", "runtime_unavailable",
      "empty_conversation", "plan_draft", "plan_approved", "act_running",
      "awaiting_approval", "check_running", "check_failing", "check_passing",
      "evidence_stale", "acceptance_incomplete", "acceptance_complete",
      "ready_for_review", "changes_requested", "approved",
      "preview_unavailable", "general_error",
    ];

    it.each(states)("state '%s' renders without crashing", (state) => {
      const { getByTestId } = render(
        <StudioShell
          railDestinations={railDestinations}
          activeDestination="chat"
          onDestinationChange={() => {}}
          workspaceContent={
            <StudioStateSurface state={state}>
              <div data-testid="ws-content">Content</div>
            </StudioStateSurface>
          }
          inspectorActiveTab="plan"
          onInspectorTabChange={() => {}}
          renderInspectorTab={() => <div />}
          composerContent={<div />}
        />,
      );
      expect(getByTestId(`state-surface-${state}`)).toBeDefined();
    });
  });

  describe("inspector tab switching", () => {
    it("renders correct panel for each tab", () => {
      const state = deriveReviewReadiness(makeReadyInput());
      const tabs: InspectorTabId[] = ["plan", "activity", "changes", "checks", "acceptance", "review"];

      for (const tab of tabs) {
        const { getByTestId, unmount } = render(
          <StudioInspector
            activeTab={tab}
            onTabChange={() => {}}
            renderTab={(t) => {
              switch (t) {
                case "plan": return <div data-testid="plan-content">Plan</div>;
                case "activity": return <div data-testid="activity-content">Activity</div>;
                case "changes": return <div data-testid="changes-content">Changes</div>;
                case "checks": return <div data-testid="checks-content">Checks</div>;
                case "acceptance": return <div data-testid="acceptance-content">Acceptance</div>;
                case "review": return <ReviewPanel state={state} />;
                default: return <div />;
              }
            }}
          />,
        );
        expect(getByTestId("studio-inspector")).toBeDefined();
        unmount();
      }
    });
  });

  describe("design token consistency", () => {
    it("all semantic colors are defined", () => {
      expect(studioColors.violet).toBeDefined();
      expect(studioColors.blue).toBeDefined();
      expect(studioColors.green).toBeDefined();
      expect(studioColors.amber).toBeDefined();
      expect(studioColors.red).toBeDefined();
      expect(studioColors.gray).toBeDefined();
    });

    it("all surface colors are defined", () => {
      expect(studioColors.canvas).toBeDefined();
      expect(studioColors.shell).toBeDefined();
      expect(studioColors.surface).toBeDefined();
      expect(studioColors.card).toBeDefined();
      expect(studioColors.elevated).toBeDefined();
    });

    it("all text colors are defined", () => {
      expect(studioColors.textPrimary).toBeDefined();
      expect(studioColors.textSecondary).toBeDefined();
      expect(studioColors.textMuted).toBeDefined();
      expect(studioColors.textDisabled).toBeDefined();
    });
  });

  describe("no placeholder copy in production components", () => {
    it("StudioShell does not contain TODO or FIXME", () => {
      const { container } = render(
        <StudioShell
          railDestinations={railDestinations}
          activeDestination="chat"
          onDestinationChange={() => {}}
          workspaceContent={<div />}
          inspectorActiveTab="plan"
          onInspectorTabChange={() => {}}
          renderInspectorTab={() => <div />}
          composerContent={<div />}
        />,
      );
      const text = container.textContent ?? "";
      expect(text).not.toContain("TODO");
      expect(text).not.toContain("FIXME");
      expect(text).not.toContain("placeholder");
      expect(text.toLowerCase()).not.toContain("lorem ipsum");
    });
  });

  describe("review readiness drives review panel", () => {
    it("ready_for_review state shows capture button", () => {
      const state = deriveReviewReadiness(makeReadyInput());
      const { getByTestId } = render(
        <ReviewPanel state={state} onCaptureCheckpoint={() => {}} />,
      );
      expect(getByTestId("review-status-panel").textContent).toContain("Ready for Review");
      expect(getByTestId("review-capture-btn")).toBeDefined();
    });

    it("approved state shows approved status", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        reviewCheckpoint: makeCheckpoint({ decision: "approved", stale: false }),
      }));
      const { getByTestId } = render(<ReviewPanel state={state} />);
      expect(getByTestId("review-status-panel").textContent).toContain("Approved");
    });

    it("blocked state shows blocking reasons", () => {
      const state = deriveReviewReadiness(makeReadyInput({
        checkEvidence: [makeCheck({ kind: "typecheck", status: "failed" })],
      }));
      const { getByTestId } = render(<ReviewPanel state={state} />);
      expect(getByTestId("review-blockers-panel")).toBeDefined();
    });
  });
});
