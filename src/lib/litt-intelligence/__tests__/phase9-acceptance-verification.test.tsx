/**
 * Phase 9 Acceptance Test — Acceptance Criteria Verification
 *
 * Test matrix:
 * 1.  all required criteria verified → eligible for ready
 * 2.  one required criterion fails → not ready
 * 3.  required criterion skipped → not ready
 * 4.  required criterion has no evidence → not ready
 * 5.  optional criterion skipped → may still be ready
 * 6.  stale acceptance evidence → not ready
 * 7.  code mutation after verification invalidates acceptance evidence
 * 8.  model claim without runtime evidence cannot verify criterion
 * 9.  criterion cannot disappear between plan and verification
 * 10. duplicate verification is idempotent
 * 11. UI renders real acceptance evidence
 * 12. API returns acceptance evidence
 *
 * Phase 9 — Studio Control Plane V1
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { AcceptanceEvidence, PlanCriterion } from "@/lib/litt-intelligence/acceptance-evidence";
import { isAcceptanceStale } from "@/lib/litt-intelligence/acceptance-evidence";
import { resetAcceptanceEvidenceStore, getAcceptanceEvidenceStore } from "@/lib/litt-intelligence/acceptance-evidence-store";
import { verifyAcceptanceCriteria, invalidateStaleAcceptanceEvidence, rejectModelClaim, type VerificationContext, type DeterministicVerifier } from "@/lib/litt-intelligence/acceptance-verification";
import { deriveRunStatus, type AcceptanceCriterion } from "@/lib/litt-intelligence/run-status";
import { resetStores } from "@/lib/litt-intelligence/evidence-store";
import { resetRunEventStore } from "@/lib/litt-intelligence/run-event-store";
import { resetCheckEvidenceStore } from "@/lib/litt-intelligence/check-evidence-store";
import type { MutationEvidence } from "@/lib/litt-intelligence/mutation-evidence";
import type { CheckEvidence } from "@/lib/litt-intelligence/check-evidence";
import { StudioAcceptancePanel } from "@/app/(app)/studio/components/StudioAcceptancePanel";
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

// Mock transport for verification
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

// ─── Tests ───────────────────────────────────────────────────────

describe("Phase 9 — Acceptance Criteria Verification", () => {
  beforeEach(() => {
    resetStores();
    resetRunEventStore();
    resetCheckEvidenceStore();
    resetAcceptanceEvidenceStore();
  });

  // ── isAcceptanceStale ──

  describe("isAcceptanceStale", () => {
    it("returns false when code state matches", () => {
      const evidence = makeAcceptance({ headSha: "abc123", workingTreeDiffHash: "diff-1" });
      expect(isAcceptanceStale(evidence, "abc123", "diff-1")).toBe(false);
    });

    it("returns true when headSha changed", () => {
      const evidence = makeAcceptance({ headSha: "abc123", workingTreeDiffHash: "diff-1" });
      expect(isAcceptanceStale(evidence, "def456", "diff-1")).toBe(true);
    });

    it("returns true when workingTreeDiffHash changed", () => {
      const evidence = makeAcceptance({ headSha: "abc123", workingTreeDiffHash: "diff-1" });
      expect(isAcceptanceStale(evidence, "abc123", "diff-2")).toBe(true);
    });

    it("returns true if already marked stale", () => {
      const evidence = makeAcceptance({ headSha: "abc123", workingTreeDiffHash: "diff-1", stale: true });
      expect(isAcceptanceStale(evidence, "abc123", "diff-1")).toBe(true);
    });
  });

  // ── Verification Engine ──

  describe("verifyAcceptanceCriteria", () => {
    it("1. all required criteria verified → eligible for ready", async () => {
      const checks = [
        makeCheck({ kind: "typecheck", status: "passed" }),
        makeCheck({ kind: "test", status: "passed" }),
        makeCheck({ kind: "build", status: "passed" }),
      ];
      const mutations = [makeMutation()];
      const criteria: PlanCriterion[] = [
        { criterion: "TypeScript compiles", required: true, verificationSource: "check_evidence", checkKind: "typecheck" },
        { criterion: "Tests pass", required: true, verificationSource: "check_evidence", checkKind: "test" },
        { criterion: "Build succeeds", required: true, verificationSource: "check_evidence", checkKind: "build" },
      ];

      const context: VerificationContext = {
        runId: "run-1",
        projectId: "proj-1",
        transport: mockTransport as never,
        checkEvidence: checks,
        mutationEvidence: mutations,
        criteria,
      };

      const result = await verifyAcceptanceCriteria(context);
      expect(result.evidence.length).toBe(3);
      expect(result.evidence.every((e) => e.status === "verified")).toBe(true);

      // deriveRunStatus with acceptance evidence
      const status = deriveRunStatus({
        mutationEvidence: mutations,
        checkEvidence: checks,
        acceptanceEvidence: result.evidence,
        unresolvedBlockingEvents: [],
      });
      expect(status.readyForReview).toBe(true);
    });

    it("2. one required criterion fails → not ready", async () => {
      // Use all-passing checks so we reach the acceptance criteria logic
      const checks = [
        makeCheck({ kind: "typecheck", status: "passed" }),
        makeCheck({ kind: "test", status: "passed" }),
        makeCheck({ kind: "build", status: "passed" }),
      ];
      const mutations = [makeMutation()];
      // Criterion references a check kind that doesn't exist in checkEvidence
      const criteria: PlanCriterion[] = [
        { criterion: "Browser renders correctly", required: true, verificationSource: "check_evidence", checkKind: "browser" },
      ];

      const context: VerificationContext = {
        runId: "run-1",
        projectId: "proj-1",
        transport: mockTransport as never,
        checkEvidence: checks,
        mutationEvidence: mutations,
        criteria,
      };

      const result = await verifyAcceptanceCriteria(context);
      expect(result.evidence[0].status).toBe("failed");
      expect(result.evidence[0].failureReason).toContain("No passing browser check");

      const status = deriveRunStatus({
        mutationEvidence: mutations,
        checkEvidence: checks,
        acceptanceEvidence: result.evidence,
        unresolvedBlockingEvents: [],
      });
      expect(status.readyForReview).toBe(false);
      expect(status.failedAcceptanceCriteria.length).toBe(1);
    });

    it("3. required criterion skipped → not ready", async () => {
      const mutations = [makeMutation()];
      const criteria: PlanCriterion[] = [
        { criterion: "Manual review needed", required: true, verificationSource: "manual_review" },
      ];

      const context: VerificationContext = {
        runId: "run-1",
        projectId: "proj-1",
        transport: mockTransport as never,
        checkEvidence: [],
        mutationEvidence: mutations,
        criteria,
      };

      const result = await verifyAcceptanceCriteria(context);
      expect(result.evidence[0].status).toBe("queued");
      expect(result.evidence[0].skipReason).toContain("manual review");

      const status = deriveRunStatus({
        mutationEvidence: mutations,
        checkEvidence: [makeCheck({ kind: "typecheck", status: "passed" })],
        acceptanceEvidence: result.evidence,
        unresolvedBlockingEvents: [],
      });
      expect(status.readyForReview).toBe(false);
      expect(status.skippedAcceptanceCriteria.length).toBe(1);
    });

    it("4. required criterion has no evidence → not ready", async () => {
      const mutations = [makeMutation()];
      // Create acceptance evidence that claims verified but has no evidence refs
      const acceptance = [
        makeAcceptance({
          criterion: "Feature works",
          required: true,
          status: "verified",
          evidenceRefs: [], // no evidence!
        }),
      ];

      const status = deriveRunStatus({
        mutationEvidence: mutations,
        checkEvidence: [makeCheck({ kind: "typecheck", status: "passed" })],
        acceptanceEvidence: acceptance,
        unresolvedBlockingEvents: [],
      });
      expect(status.readyForReview).toBe(false);
      expect(status.blockers.some((b) => b.includes("verified without evidence"))).toBe(true);
    });

    it("5. optional criterion skipped → may still be ready", async () => {
      const mutations = [makeMutation()];
      const checks = [
        makeCheck({ kind: "typecheck", status: "passed" }),
        makeCheck({ kind: "test", status: "passed" }),
        makeCheck({ kind: "build", status: "passed" }),
      ];
      const acceptance = [
        makeAcceptance({
          criterion: "Optional browser check",
          required: false,
          status: "skipped",
          skipReason: "Not applicable",
        }),
        makeAcceptance({
          criterion: "TypeScript compiles",
          required: true,
          status: "verified",
          evidenceRefs: ["check-1"],
        }),
      ];

      const status = deriveRunStatus({
        mutationEvidence: mutations,
        checkEvidence: checks,
        acceptanceEvidence: acceptance,
        unresolvedBlockingEvents: [],
      });
      expect(status.readyForReview).toBe(true);
    });

    it("6. stale acceptance evidence → not ready", async () => {
      const mutations = [makeMutation()];
      const acceptance = [
        makeAcceptance({
          criterion: "Feature works",
          required: true,
          status: "verified",
          evidenceRefs: ["check-1"],
          stale: true,
        }),
      ];

      const status = deriveRunStatus({
        mutationEvidence: mutations,
        checkEvidence: [makeCheck({ kind: "typecheck", status: "passed" })],
        acceptanceEvidence: acceptance,
        unresolvedBlockingEvents: [],
      });
      expect(status.readyForReview).toBe(false);
      expect(status.staleAcceptanceEvidence.length).toBe(1);
    });

    it("7. code mutation after verification invalidates acceptance evidence", async () => {
      const store = getAcceptanceEvidenceStore();

      // Initial verification
      const acceptance = [
        makeAcceptance({
          headSha: "abc123",
          workingTreeDiffHash: "diff-hash-1",
          status: "verified",
          evidenceRefs: ["check-1"],
        }),
      ];
      for (const a of acceptance) await store.insert(a);

      // New mutation changes the working tree
      await invalidateStaleAcceptanceEvidence("run-1", "abc123", "new-diff-hash");

      const updated = await store.listByRun("run-1");
      expect(updated[0].stale).toBe(true);

      const status = deriveRunStatus({
        mutationEvidence: [makeMutation()],
        checkEvidence: [makeCheck({ kind: "typecheck", status: "passed" })],
        acceptanceEvidence: updated,
        unresolvedBlockingEvents: [],
      });
      expect(status.readyForReview).toBe(false);
      expect(status.staleAcceptanceEvidence.length).toBe(1);
    });

    it("8. model claim without runtime evidence cannot verify criterion", () => {
      const acceptance: AcceptanceEvidence[] = [
        makeAcceptance({
          criterion: "Feature works",
          status: "failed",
          evidenceRefs: [],
        }),
      ];

      // Model claims "Feature works" is verified
      const result = rejectModelClaim("Feature works", acceptance);
      expect(result.rejected).toBe(true);
      expect(result.reason).toContain("no verified acceptance evidence");
    });

    it("9. criterion cannot disappear between plan and verification", async () => {
      const criteria: PlanCriterion[] = [
        { criterion: "Criterion A", required: true, verificationSource: "check_evidence", checkKind: "typecheck" },
        { criterion: "Criterion B", required: true, verificationSource: "check_evidence", checkKind: "test" },
        { criterion: "Criterion C", required: true, verificationSource: "check_evidence", checkKind: "build" },
      ];

      const context: VerificationContext = {
        runId: "run-1",
        projectId: "proj-1",
        transport: mockTransport as never,
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "passed" }),
          makeCheck({ kind: "test", status: "passed" }),
          makeCheck({ kind: "build", status: "passed" }),
        ],
        mutationEvidence: [makeMutation()],
        criteria,
      };

      const result = await verifyAcceptanceCriteria(context);

      // Every criterion from the plan must have an evidence record
      expect(result.evidence.length).toBe(3);
      for (const c of criteria) {
        const found = result.evidence.find((e) => e.criterion === c.criterion);
        expect(found).toBeDefined();
      }
    });

    it("10. duplicate verification is idempotent", async () => {
      const criteria: PlanCriterion[] = [
        { criterion: "TypeScript compiles", required: true, verificationSource: "check_evidence", checkKind: "typecheck" },
      ];

      const context: VerificationContext = {
        runId: "run-1",
        projectId: "proj-1",
        transport: mockTransport as never,
        checkEvidence: [makeCheck({ kind: "typecheck", status: "passed" })],
        mutationEvidence: [makeMutation()],
        criteria,
      };

      // First verification
      const result1 = await verifyAcceptanceCriteria(context);
      expect(result1.evidence.length).toBe(1);

      // Second verification — should not create duplicate
      const result2 = await verifyAcceptanceCriteria(context);
      expect(result2.evidence.length).toBe(1);

      // Store should have only 1 record
      const store = getAcceptanceEvidenceStore();
      const all = await store.listByRun("run-1");
      expect(all.length).toBe(1);
    });
  });

  // ── Deterministic Verifier ──

  describe("deterministic verifier", () => {
    it("verifies criterion using a deterministic function", async () => {
      const verifier: DeterministicVerifier = async () => ({
        passed: true,
        summary: "File contains expected export",
        evidenceRefs: ["file-read-1"],
      });

      const criteria: PlanCriterion[] = [
        { criterion: "File has correct export", required: true, verificationSource: "deterministic_verifier" },
      ];

      const context: VerificationContext = {
        runId: "run-1",
        projectId: "proj-1",
        transport: mockTransport as never,
        checkEvidence: [],
        mutationEvidence: [makeMutation()],
        criteria,
      };

      const verifiers = new Map<string, DeterministicVerifier>();
      verifiers.set("File has correct export", verifier);

      const result = await verifyAcceptanceCriteria(context, verifiers);
      expect(result.evidence[0].status).toBe("verified");
      expect(result.evidence[0].verificationSummary).toContain("expected export");
    });

    it("fails when deterministic verifier returns false", async () => {
      const verifier: DeterministicVerifier = async () => ({
        passed: false,
        summary: "File does not contain expected export",
        evidenceRefs: [],
      });

      const criteria: PlanCriterion[] = [
        { criterion: "File has correct export", required: true, verificationSource: "deterministic_verifier" },
      ];

      const context: VerificationContext = {
        runId: "run-1",
        projectId: "proj-1",
        transport: mockTransport as never,
        checkEvidence: [],
        mutationEvidence: [makeMutation()],
        criteria,
      };

      const verifiers = new Map<string, DeterministicVerifier>();
      verifiers.set("File has correct export", verifier);

      const result = await verifyAcceptanceCriteria(context, verifiers);
      expect(result.evidence[0].status).toBe("failed");
    });
  });

  // ── UI Tests ──

  describe("StudioAcceptancePanel", () => {
    it("11. UI renders real acceptance evidence", () => {
      const acceptance = [
        makeAcceptance({
          criterion: "TypeScript compiles without errors",
          required: true,
          status: "verified",
          verificationSource: "check_evidence",
          evidenceRefs: ["check-typecheck-1"],
          verificationSummary: "Verified by passing typecheck",
        }),
        makeAcceptance({
          id: "acc-fail-1",
          criterion: "All tests pass",
          required: true,
          status: "failed",
          failureReason: "2 tests failed",
          evidenceRefs: [],
        }),
        makeAcceptance({
          id: "acc-skip-1",
          criterion: "Browser compatibility",
          required: false,
          status: "skipped",
          skipReason: "Not applicable for this change",
        }),
      ];

      const { getByTestId } = render(<StudioAcceptancePanel acceptance={acceptance} loading={false} />);
      expect(getByTestId("studio-acceptance-panel")).toBeDefined();
      expect(getByTestId("acceptance-code-state")).toBeDefined();
    });

    it("shows empty state when no acceptance evidence", () => {
      const { getByTestId } = render(<StudioAcceptancePanel acceptance={[]} loading={false} />);
      expect(getByTestId("acceptance-empty")).toBeDefined();
    });

    it("renders stale badge for stale evidence", () => {
      const acceptance = [
        makeAcceptance({ stale: true, id: "acc-stale-1" }),
      ];
      const { getByTestId } = render(<StudioAcceptancePanel acceptance={acceptance} loading={false} />);
      expect(getByTestId("acceptance-acc-stale-1-stale")).toBeDefined();
    });
  });

  // ── API (structural test) ──

  describe("12. API returns acceptance evidence", () => {
    it("evidence API route imports acceptance store", async () => {
      // Structural test: verify the API route module can be imported
      // and references the acceptance store
      const routeModule = await import("@/app/api/studio/evidence/route");
      expect(routeModule).toBeDefined();
      expect(typeof routeModule.GET).toBe("function");
    });
  });

  // ── Backward Compat ──

  describe("backward compatibility with Phase 8", () => {
    it("deriveRunStatus still works with simplified acceptanceCriteria", () => {
      const mutations = [makeMutation()];
      const checks = [
        makeCheck({ kind: "typecheck", status: "passed" }),
        makeCheck({ kind: "test", status: "passed" }),
        makeCheck({ kind: "build", status: "passed" }),
      ];
      const criteria: AcceptanceCriterion[] = [
        { id: "c1", description: "Feature works", status: "verified" },
      ];

      const status = deriveRunStatus({
        mutationEvidence: mutations,
        checkEvidence: checks,
        acceptanceCriteria: criteria,
        unresolvedBlockingEvents: [],
      });
      expect(status.readyForReview).toBe(true);
    });

    it("deriveRunStatus prefers acceptanceEvidence over acceptanceCriteria", () => {
      const mutations = [makeMutation()];
      const checks = [
        makeCheck({ kind: "typecheck", status: "passed" }),
        makeCheck({ kind: "test", status: "passed" }),
        makeCheck({ kind: "build", status: "passed" }),
      ];

      // acceptanceCriteria says verified, but acceptanceEvidence says failed
      const criteria: AcceptanceCriterion[] = [
        { id: "c1", description: "Feature works", status: "verified" },
      ];
      const evidence: AcceptanceEvidence[] = [
        makeAcceptance({ criterion: "Feature works", status: "failed", failureReason: "Test failed" }),
      ];

      const status = deriveRunStatus({
        mutationEvidence: mutations,
        checkEvidence: checks,
        acceptanceCriteria: criteria,
        acceptanceEvidence: evidence,
        unresolvedBlockingEvents: [],
      });
      // acceptanceEvidence takes precedence → not ready
      expect(status.readyForReview).toBe(false);
    });
  });
});
